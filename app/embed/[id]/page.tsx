import type { Metadata } from 'next';
import { loadPublicVideo, creatorName } from '@/lib/publicVideo';
import { SITE_URL, videoThumbnail } from '@/lib/linkPreview';
import { watchUrl } from '@/lib/embed';

/**
 * Vložitelný přehrávač: /embed/<id>
 *
 * Stránka bez kostry appky (menu, lišty), jen video a malý odkaz zpět na
 * Kine. Sem ukazují og:video a twitter:player z náhledů odkazů (Discord,
 * X přehrají video rovnou v příspěvku), sem vede kód "Vložit na web" a
 * odsud bere přehrávač oEmbed. Cizí stránky ji smí načíst do rámu -
 * hlavičky pro /embed jsou v next.config.js (jinde je rámování zakázané).
 *
 * Jen veřejná a hotová videa. Soukromé video se tu neukáže ani názvem.
 */

export const revalidate = 300;

type Props = { params: { id: string }; searchParams: { t?: string } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const video = await loadPublicVideo(params.id);
  return {
    // absolute: bez šablony "| Kine" z kořenového layoutu (bylo by "Kine | Kine").
    title: { absolute: video ? `${video.title} · Kine` : 'Kine' },
    // Vložený přehrávač se neindexuje - patří do výsledků stránka videa.
    robots: { index: false, follow: true },
    alternates: { canonical: `${SITE_URL}/watch/${params.id}` },
  };
}

export default async function EmbedPage({ params, searchParams }: Props) {
  const video = await loadPublicVideo(params.id);

  if (!video || !video.cloudflare_video_id) {
    return (
      <div className="embed-shell embed-unavailable">
        <p>Toto video není na Kine veřejně dostupné.</p>
        <a href={SITE_URL} target="_blank" rel="noopener noreferrer">Kine</a>
      </div>
    );
  }

  const start = Number(searchParams?.t);
  const startTime = Number.isFinite(start) && start > 0 ? Math.floor(start) : 0;
  const poster = videoThumbnail(video.thumbnail_url, video.cloudflare_video_id);
  const src =
    `https://iframe.videodelivery.net/${video.cloudflare_video_id}` +
    `?preload=metadata` +
    (poster ? `&poster=${encodeURIComponent(poster)}` : '') +
    (startTime ? `&startTime=${startTime}s` : '');

  return (
    <div className="embed-shell">
      <iframe
        className="embed-frame"
        src={src}
        title={video.title}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
      {/* Odkaz zpět: kdo video vidí na cizím webu nebo na Discordu, má kam kliknout. */}
      <a className="embed-badge" href={watchUrl(video.id)} target="_blank" rel="noopener noreferrer">
        <span className="embed-badge-logo">Kine</span>
        <span className="embed-badge-title">{video.title}</span>
        <span className="embed-badge-creator">{creatorName(video)}</span>
      </a>
    </div>
  );
}
