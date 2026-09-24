import { supabaseServer } from './supabaseServer';
import { autoCaptionLanguage, parseSubtitles, type Caption } from './captions';

/**
 * Automatické titulky přes Cloudflare Stream (AI, pro zákazníky Stream
 * zdarma). Po zpracování videa se o ně požádá (markVideoReady), hotové se
 * převezmou do videos.captions při úklidu (sweepProcessing) - jen když
 * tvůrce nemá vlastní. Stav je ve sloupci videos.auto_captions
 * (requested / done / failed); bez migrace se nic neděje.
 *
 * Tvůrce si je může vyžádat i ručně v úpravách videa (/api/videos/captions).
 */

const MAX_SECONDS = 2 * 60 * 60;

function cf(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  return accountId && token ? { accountId, token } : null;
}

async function cfCall(path: string, init: RequestInit = {}): Promise<Response> {
  const c = cf();
  if (!c) throw new Error('Cloudflare Stream není nastavený.');
  return fetch(`https://api.cloudflare.com/client/v4/accounts/${c.accountId}/stream${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) },
    cache: 'no-store',
  });
}

/** Požádá Cloudflare o vygenerování titulků v daném jazyce. */
export async function generateCaptions(uid: string, language: string): Promise<void> {
  const res = await cfCall(`/${uid}/captions/${language}/generate`, { method: 'POST' });
  const body = await res.json().catch(() => null);
  // "už existují" není chyba - stačí si je pak vyzvednout.
  if (!res.ok && !(body?.errors ?? []).some((e: any) => /exist/i.test(String(e?.message ?? '')))) {
    throw new Error(body?.errors?.[0]?.message ?? `Cloudflare odpověděl ${res.status}`);
  }
}

export type GeneratedState = { status: 'ready'; captions: Caption[] } | { status: 'inprogress' } | { status: 'error'; message: string } | { status: 'none' };

/** Stav vygenerovaných titulků; když jsou hotové, rovnou je stáhne (WebVTT) a převede. */
export async function generatedCaptions(uid: string, language: string): Promise<GeneratedState> {
  const res = await cfCall(`/${uid}/captions`);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) return { status: 'error', message: body?.errors?.[0]?.message ?? `HTTP ${res.status}` };
  const list: any[] = Array.isArray(body.result) ? body.result : [];
  const item = list.find((c) => String(c.language).toLowerCase() === language) ?? null;
  if (!item) return { status: 'none' };
  const state = String(item.status ?? 'ready').toLowerCase();
  if (state === 'inprogress' || state === 'queued') return { status: 'inprogress' };
  if (state === 'error') return { status: 'error', message: 'Cloudflare titulky nevygeneroval.' };
  const vtt = await cfCall(`/${uid}/captions/${language}/vtt`);
  if (!vtt.ok) return { status: 'error', message: `WebVTT ${vtt.status}` };
  const captions = parseSubtitles(await vtt.text());
  return captions.length > 0 ? { status: 'ready', captions } : { status: 'error', message: 'Prázdné titulky.' };
}

/** Po zpracování videa: když nemá titulky a jazyk to dovolí, požádat o automatické. Nikdy nehodí chybu. */
export async function requestAutoCaptions(video: any): Promise<void> {
  try {
    if (!cf() || !video?.cloudflare_video_id) return;
    if (Array.isArray(video.captions) && video.captions.length > 0) return;
    if (video.auto_captions) return;
    if ((video.duration_seconds ?? 0) > MAX_SECONDS) return;
    const language = autoCaptionLanguage(video.language);
    if (!language) return;
    const mark = await supabaseServer.from('videos').update({ auto_captions: 'requested' }).eq('id', video.id).is('auto_captions', null).select('id');
    if (mark.error || !mark.data || mark.data.length === 0) return; // bez migrace nebo už to někdo vyřídil
    await generateCaptions(video.cloudflare_video_id, language);
  } catch {
    await supabaseServer.from('videos').update({ auto_captions: 'failed' }).eq('id', video.id).then(() => undefined, () => undefined);
  }
}

/** Převezme hotové automatické titulky (nejvýš `max` videí naráz). Nikdy nehodí chybu. */
export async function sweepCaptions(max = 3): Promise<number> {
  if (!cf()) return 0;
  let done = 0;
  try {
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseServer
      .from('videos')
      .select('id, cloudflare_video_id, language, captions, created_at')
      .eq('auto_captions', 'requested')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(max);
    if (error || !data) return 0;
    for (const video of data) {
      const language = autoCaptionLanguage(video.language);
      if (!language) {
        await supabaseServer.from('videos').update({ auto_captions: 'failed' }).eq('id', video.id);
        continue;
      }
      const state = await generatedCaptions(video.cloudflare_video_id, language).catch((e) => ({ status: 'error', message: String(e) }) as GeneratedState);
      if (state.status === 'ready') {
        // Tvůrce mezitím mohl napsat vlastní - ty mají přednost.
        const own = Array.isArray(video.captions) && video.captions.length > 0;
        await supabaseServer
          .from('videos')
          .update(own ? { auto_captions: 'done' } : { auto_captions: 'done', captions: state.captions })
          .eq('id', video.id);
        done += 1;
      } else if (state.status === 'error' || state.status === 'none') {
        await supabaseServer.from('videos').update({ auto_captions: 'failed' }).eq('id', video.id);
      }
    }
  } catch {
    // Úklid nesmí shodit dotaz, ze kterého se volá.
  }
  return done;
}
