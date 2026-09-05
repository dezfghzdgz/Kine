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
  const { data: video } = await supabaseServer
    .from('videos')
    .select('id, status, custom_thumbnail, owner_id, title, visibility')
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
  if (video.visibility !== 'public') return;

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
