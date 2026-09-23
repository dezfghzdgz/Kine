import { supabaseServer } from './supabaseServer';
import { shouldBeProtected, syncVideoProtection } from './streamProtection';

/**
 * "Video je zpracované" - jedno místo pro obě cesty, kterými se to appka
 * dozví.
 *
 * PROČ TO TU JE
 *
 * Video se do databáze zapíše se stavem "processing" a na "ready" ho
 * přepne teprve někdo, kdo se Cloudflare zeptá. Dokud se to nestane,
 * video nikde není - všechny seznamy berou jen "ready".
 *
 * Ptát se chodil jenom prohlížeč, a to nejvýš dvě minuty po nahrání.
 * Dvanáctiminutové video Cloudflare za dvě minuty nezpracuje, takže
 * dotazování skončilo dřív, video zůstalo navždy ve stavu "processing" a
 * na Kine se neobjevilo - přestože na Cloudflare bylo v pořádku.
 *
 * Odteď vedou k přepnutí dvě cesty:
 *   1. Cloudflare se sám ozve, až je hotovo (webhook). Nezávisí to na
 *      tom, jestli má tvůrce otevřený prohlížeč.
 *   2. Appka se doptá sama, když video někde vypisuje (záloha, kdyby
 *      webhook nebyl nastavený nebo se zpráva ztratila).
 */

export type ReadyResult = 'ready' | 'processing' | 'not-found';

/**
 * Zapíše, že je video hotové, a rozešle oznámení odběratelům.
 *
 * `payload` jsou údaje od Cloudflare (z odpovědi API nebo z webhooku) -
 * obojí má stejná pole.
 */
export async function markVideoReady(
  videoId: string,
  payload: { duration?: number; thumbnail?: string; input?: { width?: number; height?: number } }
): Promise<void> {
  // select('*') schválně: čtou se i sloupce z novějších migrací (klipy),
  // které v databázi ještě být nemusí - výběr podle jména by bez nich spadl.
  const { data: video } = await supabaseServer
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single();

  if (!video || video.status === 'ready') return;

  const updates: any = {
    status: 'ready',
    duration_seconds: Math.round(payload.duration || 0),
  };
  if (!video.custom_thumbnail && payload.thumbnail) updates.thumbnail_url = payload.thumbnail;
  if (payload.input?.width) updates.width = payload.input.width;
  if (payload.input?.height) updates.height = payload.input.height;

  await supabaseServer.from('videos').update(updates).eq('id', videoId);

  // Neveřejné video: podepsané adresy u Cloudflare a náhled přenesený do
  // úložiště Kine - náhled přímo z Cloudflare by pod ochranou nešel
  // (lib/streamProtection.ts; bez nastaveného klíče nic nedělá).
  if (shouldBeProtected(video.visibility)) {
    await syncVideoProtection(videoId);
  }

  // Video se právě stalo "ready" a je veřejné - vhodná chvíle poslat
  // oznámení odběratelům, kteří si to u tohohle kanálu přejí (zvoneček
  // vedle "Odebírat"). Kontrola stavu výš zajišťuje, že se oznámení
  // pošlou jen jednou, i kdyby přišly obě cesty naráz.
  // Klip není nové video tvůrce (vystřihl ho divák) - odběratelům se nehlásí.
  if (video.visibility !== 'public' || video.clipped_from_video_id) return;

  const { data: subs } = await supabaseServer
    .from('subscriptions')
    .select('subscriber_id')
    .eq('channel_id', video.owner_id)
    .eq('notify_new_videos', true);

  if (!subs || subs.length === 0) return;

  await supabaseServer.from('notifications').insert(
    subs.map((s: any) => ({
      user_id: s.subscriber_id,
      type: 'new_video',
      message: `Nové video: "${video.title}"`,
      link: `/watch/${videoId}`,
    }))
  );
}

/** Zeptá se Cloudflare na stav videa a případně ho přepne na hotové. */
export async function refreshFromCloudflare(videoId: string): Promise<ReadyResult> {
  const { data: video } = await supabaseServer
    .from('videos')
    .select('id, cloudflare_video_id, status')
    .eq('id', videoId)
    .single();

  if (!video) return 'not-found';
  if (video.status === 'ready') return 'ready';

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${video.cloudflare_video_id}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const cfData = await cfRes.json().catch(() => ({ success: false }));

  if (!cfData.success || !cfData.result?.readyToStream) return 'processing';

  await markVideoReady(videoId, cfData.result);
  return 'ready';
}

/**
 * Úklid zaseklých videí ("processing" déle než minutu).
 *
 * PROČ TO TU JE
 *
 * Doptávat se chodil jen prohlížeč tvůrce (stránka nahrávání, Tvoje videa,
 * stránka videa). Appka Kine do PC video nahrála, potvrdila - a nikdo se
 * už nezeptal, jestli je hotové. Na Cloudflare bylo v pořádku, na Kine
 * viselo jako "processing" a v žádném seznamu nebylo, dokud si tvůrce
 * neotevřel Tvoje videa. Bez webhooku od Cloudflare (který se musí
 * nastavit ručně) se to dřív nikdy samo nespravilo.
 *
 * Tohle projde nejstarší zaseklá videa (nejvýš `max` naráz, z posledních
 * sedmi dnů, starší než minutu - Cloudflare potřebuje chvíli) a u každého
 * se zeptá. Volá se z míst, kam chodí provoz i bez tvůrce (dotaz na stav,
 * záloha stránky videa, potvrzení nahrání, appka Kine do PC při startu),
 * ale nejvýš jednou za `THROTTLE_MS` na instanci - jinak by každý dotaz
 * platil daň za cizí videa. Denně to navíc pouští cron (vercel.json ->
 * /api/videos/sweep). Nikdy nehodí chybu - je to úklid, ne odpověď.
 */
const SWEEP_THROTTLE_MS = 90 * 1000;
let lastSweepAt = 0;
let sweeping: Promise<SweepResult> | null = null;

export type SweepResult = { checked: number; ready: number; skipped: boolean };

export async function sweepProcessing(options: { max?: number; force?: boolean } = {}): Promise<SweepResult> {
  const max = Math.max(1, Math.min(options.max ?? 4, 25));
  const now = Date.now();
  if (!options.force && now - lastSweepAt < SWEEP_THROTTLE_MS) return { checked: 0, ready: 0, skipped: true };
  // Dva souběžné dotazy nespustí dva úklidy - druhý počká na první.
  if (sweeping) return sweeping;
  lastSweepAt = now;
  sweeping = (async () => {
    const result: SweepResult = { checked: 0, ready: 0, skipped: false };
    try {
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const minuteAgo = new Date(now - 60 * 1000).toISOString();
      const { data } = await supabaseServer
        .from('videos')
        .select('id')
        .neq('status', 'ready')
        .gte('created_at', weekAgo)
        .lte('created_at', minuteAgo)
        .order('created_at', { ascending: true })
        .limit(max);
      for (const row of data ?? []) {
        result.checked += 1;
        try {
          if ((await refreshFromCloudflare(row.id)) === 'ready') result.ready += 1;
        } catch {
          // Jedno video nejde ověřit (síť, Cloudflare) - další se zkusí dál.
        }
      }
    } catch {
      // Úklid nesmí shodit dotaz, ze kterého se volá.
    }
    return result;
  })();
  try {
    return await sweeping;
  } finally {
    sweeping = null;
  }
}
