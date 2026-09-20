import type { Metadata } from 'next';
import { SITE_URL, shorten, videoThumbnail } from '@/lib/linkPreview';
import { loadPublicVideo, creatorName } from '@/lib/publicVideo';
import { embedUrl, isoDuration, watchUrl } from '@/lib/embed';
import { manifestUrl, customerCodeFromUrl } from '@/lib/streamSource';

// Náhled se smí chvíli držet v paměti - název ani obrázek videa se běžně
// nemění každou minutu a nemá smysl kvůli každému robotovi sahat do databáze.
export const revalidate = 300;

/**
 * Náhledy odkazů a strukturovaná data stránky videa.
 *
 * Kdo hodí odkaz na video do Discordu, na X, do Slacku nebo na vlastní
 * web, dostane název, popis, náhled - a PŘEHRÁVAČ: og:video i twitter:player
 * ukazují na /embed/<id>, náš vložitelný přehrávač s odkazem zpět na Kine
 * (dřív tam byl holý přehrávač Cloudflare bez jakékoli stopy po Kine).
 * oEmbed (application/json+oembed) si berou WordPress, Notion nebo Slack.
 * JSON-LD VideoObject je pro Google - video se může objevit ve výsledcích
 * jako video s náhledem a délkou, ne jako obyčejný odkaz.
 *
 * Soukromá videa a videa jen pro odběratele nesmí přes náhled odkazu
 * prozradit ani název - loadPublicVideo je vůbec nevrátí.
 */
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const video = await loadPublicVideo(params.id);

  if (!video) {
    return { title: 'Video', robots: { index: false, follow: false } };
  }

  const creator = creatorName(video);
  const description = shorten(video.description) ?? `${creator} · Kine`;
  const image = videoThumbnail(video.thumbnail_url, video.cloudflare_video_id);
  const url = watchUrl(video.id);
  const player = embedUrl(video.id);
  const width = video.width ?? 1280;
  const height = video.height ?? 720;
  const oembed = `${SITE_URL}/api/oembed?url=${encodeURIComponent(url)}&format=json`;

  return {
    title: video.title,
    description,
    alternates: {
      canonical: url,
      types: { 'application/json+oembed': oembed },
    },
    openGraph: {
      type: 'video.other',
      title: video.title,
      description,
      url,
      siteName: 'Kine',
      images: image ? [{ url: image, width: 1280, height: 720, alt: video.title }] : undefined,
      // Díky tomuhle umí Discord i Facebook video přehrát rovnou v příspěvku.
      videos: video.cloudflare_video_id
        ? [{ url: player, secureUrl: player, type: 'text/html', width, height }]
        : undefined,
    },
    twitter: video.cloudflare_video_id
      ? {
          card: 'player',
          title: video.title,
          description,
          images: image ? [image] : undefined,
          players: [
            {
              playerUrl: player,
              streamUrl: manifestUrl(video.cloudflare_video_id, customerCodeFromUrl(video.thumbnail_url)),
              width,
              height,
            },
          ],
        }
      : { card: 'summary_large_image', title: video.title, description, images: image ? [image] : undefined },
  };
}

export default async function WatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const video = await loadPublicVideo(params.id);

  // Strukturovaná data pro vyhledávače (schema.org/VideoObject). Jen u
  // veřejných videí; JSON.stringify sám escapuje uvozovky, "<" se navíc
  // převede, aby text videa nemohl ukončit značku <script>.
  const jsonLd = video
    ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: video.title,
        description: shorten(video.description, 500) ?? video.title,
        thumbnailUrl: videoThumbnail(video.thumbnail_url, video.cloudflare_video_id),
        uploadDate: video.created_at,
        duration: isoDuration(video.duration_seconds),
        contentUrl: watchUrl(video.id),
        embedUrl: embedUrl(video.id),
        isFamilyFriendly: video.made_for_kids ? true : undefined,
        keywords: video.hashtags && video.hashtags.length > 0 ? video.hashtags.join(', ') : undefined,
        interactionStatistic:
          typeof video.views === 'number'
            ? {
                '@type': 'InteractionCounter',
                interactionType: { '@type': 'WatchAction' },
                userInteractionCount: video.views,
              }
            : undefined,
        author: video.owner_id
          ? { '@type': 'Person', name: creatorName(video), url: `${SITE_URL}/channel/${video.owner_id}` }
          : undefined,
        publisher: { '@type': 'Organization', name: 'Kine', url: SITE_URL },
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      {children}
    </>
  );
}
