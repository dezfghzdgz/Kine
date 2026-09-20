import { supabaseServer } from '@/lib/supabaseServer';
import { SITE_URL, shorten, videoThumbnail } from '@/lib/linkPreview';
import { embedUrl, escapeXml, watchUrl } from '@/lib/embed';

/**
 * Video sitemap: /video-sitemap.xml
 *
 * Obyčejná sitemap (app/sitemap.ts) říká Googlu, které stránky existují.
 * Tahle mu k tomu říká, že jsou to VIDEA - s náhledem, délkou, počtem
 * zhlédnutí a přehrávačem. Bez toho Google video pozná jen náhodou; s tím
 * ho může ukázat ve výsledcích jako video. Next.js 14 do sitemap.ts
 * značky <video:video> zapsat neumí, proto je to zvlášť. Odkaz na ni je
 * v robots.txt.
 */

export const revalidate = 3600;

export async function GET() {
  const { data } = await supabaseServer
    .from('videos')
    .select('id, title, description, thumbnail_url, cloudflare_video_id, duration_seconds, views, created_at, made_for_kids, hashtags, owner_id, profiles!videos_owner_id_fkey(username, display_name)')
    .eq('status', 'ready')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(1000);

  const entries = (data ?? [])
    .filter((v: any) => v.cloudflare_video_id)
    .map((v: any) => {
      const owner = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
      const name = owner?.display_name || owner?.username || 'Kine';
      const thumb = videoThumbnail(v.thumbnail_url, v.cloudflare_video_id);
      const description = shorten(v.description, 2000) ?? v.title;
      const duration = Math.max(1, Math.min(28800, Math.round(v.duration_seconds ?? 0)));
      const tags = (v.hashtags ?? []).slice(0, 32).map((tag: string) => `      <video:tag>${escapeXml(tag)}</video:tag>`);

      return [
        '  <url>',
        `    <loc>${escapeXml(watchUrl(v.id))}</loc>`,
        `    <lastmod>${new Date(v.created_at).toISOString()}</lastmod>`,
        '    <video:video>',
        thumb ? `      <video:thumbnail_loc>${escapeXml(thumb)}</video:thumbnail_loc>` : '',
        `      <video:title>${escapeXml(v.title)}</video:title>`,
        `      <video:description>${escapeXml(description)}</video:description>`,
        `      <video:player_loc>${escapeXml(embedUrl(v.id))}</video:player_loc>`,
        v.duration_seconds ? `      <video:duration>${duration}</video:duration>` : '',
        `      <video:publication_date>${new Date(v.created_at).toISOString()}</video:publication_date>`,
        typeof v.views === 'number' ? `      <video:view_count>${v.views}</video:view_count>` : '',
        `      <video:family_friendly>${v.made_for_kids ? 'yes' : 'no'}</video:family_friendly>`,
        v.owner_id
          ? `      <video:uploader info="${escapeXml(`${SITE_URL}/channel/${v.owner_id}`)}">${escapeXml(name)}</video:uploader>`
          : '',
        ...tags,
        '    </video:video>',
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    });

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n' +
    entries.join('\n') +
    '\n</urlset>\n';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
