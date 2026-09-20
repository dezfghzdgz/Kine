import { NextRequest, NextResponse } from 'next/server';
import { loadPublicVideo, creatorName } from '@/lib/publicVideo';
import { SITE_URL, videoThumbnail } from '@/lib/linkPreview';
import { embedCode, embedSize, videoIdFromUrl, watchUrl } from '@/lib/embed';

/**
 * oEmbed: /api/oembed?url=https://kine.../watch/<id>&format=json
 *
 * Standard, kterým si cizí web (WordPress, Notion, Slack, Medium...) řekne
 * o přehrávač k vloženému odkazu. Odkaz na objevení je v hlavičce stránky
 * videa (app/watch/[id]/layout.tsx). Jen veřejná videa; pro cizí adresu
 * nebo neveřejné video 404, jak standard chce.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const format = params.get('format') ?? 'json';
  if (format !== 'json') {
    return NextResponse.json({ error: 'Podporovaný formát je jen json.' }, { status: 501 });
  }

  const videoId = videoIdFromUrl(params.get('url'));
  if (!videoId) {
    return NextResponse.json({ error: 'Adresa není video na Kine.' }, { status: 404 });
  }

  const video = await loadPublicVideo(videoId);
  if (!video || !video.cloudflare_video_id) {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }

  const maxWidth = Number(params.get('maxwidth')) || null;
  const maxHeight = Number(params.get('maxheight')) || null;
  const size = embedSize(video.width, video.height, maxWidth, maxHeight);
  const thumbnail = videoThumbnail(video.thumbnail_url, video.cloudflare_video_id);

  const body = {
    version: '1.0',
    type: 'video',
    provider_name: 'Kine',
    provider_url: SITE_URL,
    title: video.title,
    author_name: creatorName(video),
    author_url: video.owner_id ? `${SITE_URL}/channel/${video.owner_id}` : undefined,
    html: embedCode(video.id, { width: size.width, height: size.height, title: video.title }),
    width: size.width,
    height: size.height,
    thumbnail_url: thumbnail,
    thumbnail_width: thumbnail ? 1280 : undefined,
    thumbnail_height: thumbnail ? 720 : undefined,
    // Nestandardní, ale hodí se: kam vede odkaz.
    url: watchUrl(video.id),
  };

  return NextResponse.json(body, {
    headers: {
      // Náhledy si smí kdokoliv uložit na hodinu; adresa se nemění.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
