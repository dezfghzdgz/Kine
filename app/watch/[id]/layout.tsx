import type { Metadata } from 'next';
import { SITE_URL, shorten, videoThumbnail } from '@/lib/linkPreview';
import { loadPublicVideo, creatorName } from '@/lib/publicVideo';
import { embedUrl, isoDuration, watchUrl } from '@/lib/embed';
import { manifestUrl, customerCodeFromUrl } from '@/lib/streamSource';
import { embedMp4 } from '@/lib/streamMp4';

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
 *
 * Discord (jako u Medalu): krátké video (do 3 min) dostane v og:video
 * obyčejné MP4 - Discord ho přehraje rovnou v chatu (stránku /embed
 * nepřehraje, ukázal jen obrázek). A k tomu vlastní náhled s tlačítky
 * Watch / Follow / Download for PC (<link rel="discord:component-embed">,
 * lib/discordEmbed.ts, app/api/discord-embed).
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const video = await loadPublicVideo(id, revalidate);

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
  // MP4 krátkého videa (lib/streamMp4.ts) - Discord ho přehraje přímo v chatu; jinak přehrávač /embed.
  const mp4 = await embedMp4(video.cloudflare_video_id, video.duration_seconds);

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
      // Díky tomuhle umí Discord (MP4) i Facebook (přehrávač) video přehrát rovnou v příspěvku.
      videos: mp4
        ? [{ url: mp4, secureUrl: mp4, type: 'video/mp4', width, height }]
        : video.cloudflare_video_id
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
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const video = await loadPublicVideo(id, revalidate);

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

  // Spojení se serverem Cloudflare, odkud přehrávač stahuje video (customer-<kód>…),
  // se naváže hned při načtení stránky - ne až když si o seznam kvalit řekne přehrávač.
  const streamCode = video ? customerCodeFromUrl(video.thumbnail_url) : null;
  // Seznam kvalit (HLS manifest) veřejného videa si prohlížeč stáhne už s HTML stránky -
  // přehrávač (hls.js) ho pak má hned, ne až po načtení JavaScriptu a údajů o videu.
  const manifest = video && streamCode && video.cloudflare_video_id ? manifestUrl(video.cloudflare_video_id, streamCode) : null;

  return (
    <>
      {streamCode && <link rel="preconnect" href={`https://customer-${streamCode}.cloudflarestream.com`} crossOrigin="anonymous" />}
      {/* Vlastní náhled v Discordu (tlačítka, video) - React ho přesune do <head>, kde ho Discord hledá. */}
      {video && <link rel="discord:component-embed" type="application/json" href={`${SITE_URL}/api/discord-embed?id=${video.id}`} />}
      {manifest && <link rel="preload" href={manifest} as="fetch" crossOrigin="anonymous" />}
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
