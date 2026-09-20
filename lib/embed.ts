import { SITE_URL } from './linkPreview';

/**
 * Vložitelný přehrávač a rozbalování odkazů - čisté pomůcky bez prohlížeče
 * a bez databáze (tests/embed.test.mjs).
 *
 * PROČ
 *
 * Každé video sdílené mimo Kine je reklama na Kine - ale jen když se odkaz
 * rozbalí jako video s náhledem a dá se přehrát rovnou tam, kde ho někdo
 * poslal (Discord, X, WordPress, Notion). K tomu slouží:
 *   - /embed/<id>      přehrávač bez kostry appky, s odkazem zpět na Kine,
 *                      povolený v cizích rámech (next.config.js)
 *   - og:video, twitter:player   ukazují na ten přehrávač (app/watch/[id]/layout.tsx)
 *   - /api/oembed      standard, kterým si web (WordPress, Notion, Slack)
 *                      řekne o přehrávač k vloženému odkazu
 *   - "Vložit na web"  v nabídce Sdílet zkopíruje kód iframe
 */

export const EMBED_DEFAULT_WIDTH = 560;
export const EMBED_DEFAULT_HEIGHT = 315;

export function embedUrl(videoId: string, startSeconds?: number | null): string {
  const t = startSeconds && startSeconds > 0 ? `?t=${Math.floor(startSeconds)}` : '';
  return `${SITE_URL}/embed/${videoId}${t}`;
}

export function watchUrl(videoId: string): string {
  return `${SITE_URL}/watch/${videoId}`;
}

/** Kód iframe pro cizí web. Rozměry drží poměr stran videa. */
export function embedCode(videoId: string, opts: { width?: number | null; height?: number | null; title?: string } = {}): string {
  const { width, height } = embedSize(opts.width, opts.height);
  const title = escapeAttr(opts.title ?? 'Kine');
  return (
    `<iframe src="${embedUrl(videoId)}" width="${width}" height="${height}" ` +
    `title="${title}" frameborder="0" ` +
    `allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" ` +
    `allowfullscreen></iframe>`
  );
}

/**
 * Rozměr vloženého přehrávače: šířka 560, výška podle poměru stran videa
 * (svislé video je vysoké a úzké, ne roztažené do 16:9). Bez rozměrů 16:9.
 * Na `maxwidth`/`maxheight` z oEmbed se zmenší, poměr zůstane.
 */
export function embedSize(
  videoWidth?: number | null,
  videoHeight?: number | null,
  maxWidth?: number | null,
  maxHeight?: number | null
): { width: number; height: number } {
  const ratio = videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0 ? videoHeight / videoWidth : 9 / 16;
  let width = EMBED_DEFAULT_WIDTH;
  // Svislé video: základ je výška, ať iframe není 560 široký a 995 vysoký.
  if (ratio > 1) width = Math.round(EMBED_DEFAULT_HEIGHT / ratio);
  let height = Math.round(width * ratio);

  if (maxWidth && maxWidth > 0 && width > maxWidth) {
    width = Math.floor(maxWidth);
    height = Math.round(width * ratio);
  }
  if (maxHeight && maxHeight > 0 && height > maxHeight) {
    height = Math.floor(maxHeight);
    width = Math.round(height / ratio);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** Z adresy /watch/<id> nebo /embed/<id> na Kine vytáhne id videa; cizí adresa -> null. */
export function videoIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  let site: URL;
  try {
    site = new URL(SITE_URL);
  } catch {
    return null;
  }
  if (parsed.hostname.toLowerCase() !== site.hostname.toLowerCase()) return null;
  const m = /^\/(?:watch|embed)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(parsed.pathname);
  return m ? m[1].toLowerCase() : null;
}

/** Délka videa jako ISO 8601 trvání (PT1H2M3S) pro strukturovaná data. */
export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${sec || (!h && !m) ? `${sec}S` : ''}`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Text do XML/HTML (sitemap, JSON-LD se řeší jinak). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
