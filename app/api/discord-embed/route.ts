import { NextRequest, NextResponse } from 'next/server';
import { loadPublicVideo, creatorName } from '@/lib/publicVideo';
import { SITE_URL, videoThumbnail } from '@/lib/linkPreview';
import { watchUrl } from '@/lib/embed';
import { isFetchableMediaUrl } from '@/lib/mediaHosts';
import { gameFromHashtags } from '@/lib/games';
import { discordEmbedPayload } from '@/lib/discordEmbed';
import { embedMp4 } from '@/lib/streamMp4';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';
import { clientIpKey } from '@/lib/clientIp';

/**
 * Náhled odkazu na video v Discordu (component embed, lib/discordEmbed.ts):
 * /api/discord-embed?id=<id videa>. Odkaz na tuhle adresu je v hlavičce
 * stránky videa (app/watch/[id]/layout.tsx). Jen veřejná hotová videa
 * (loadPublicVideo) - jinak 404 a Discord ukáže obyčejný náhled.
 */
export async function GET(req: NextRequest) {
  // Ptá se Discord (pár dotazů na odkaz); víc z jedné adresy = někdo zkouší obejít cache
  // a vyčerpat dotazy na Cloudflare API (to potřebuje i nahrávání videí).
  if (!allowRequest(`discord-embed:${clientIpKey(req.headers)}`, 60, 60 * 1000)) return tooManyRequests(30);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  const video = await loadPublicVideo(id);
  if (!video || !video.cloudflare_video_id) {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }
  const mp4 = await embedMp4(video.cloudflare_video_id, video.duration_seconds);
  // Bez MP4 (dlouhé video, MP4 se teprve dělá) aspoň náhledový obrázek - jen z vlastního úložiště / Cloudflare.
  const image = videoThumbnail(isFetchableMediaUrl(video.thumbnail_url) ? video.thumbnail_url : null, video.cloudflare_video_id);
  const payload = discordEmbedPayload({
    title: video.title,
    creator: creatorName(video),
    game: gameFromHashtags(video.hashtags)?.name ?? null,
    watchUrl: watchUrl(video.id),
    channelUrl: video.owner_id ? `${SITE_URL}/channel/${video.owner_id}` : null,
    downloadUrl: `${SITE_URL}/download`,
    mediaUrl: mp4 ?? image ?? null,
    accent: '#00c9a7',
  });
  if (!payload) return NextResponse.json({ error: 'Náhled se nevešel.' }, { status: 404 });
  return NextResponse.json(payload, {
    headers: {
      // Discord si náhled drží ~30 min sám; tady 5 min - MP4 se mezitím může dodělat.
      'Cache-Control': mp4 ? 'public, max-age=600, s-maxage=600' : 'public, max-age=120, s-maxage=120',
    },
  });
}
