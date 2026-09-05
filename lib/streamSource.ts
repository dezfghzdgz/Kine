/**
 * Zdroj zvuku a obrazu pro vlastní přehrávač hudby (lib/musicPlayer.tsx).
 *
 * PROČ VLASTNÍ PŘEHRÁVAČ
 *
 * Hudba dosud hrála v iframu Cloudflare. Ten má dvě vady, které se na
 * telefonu nedají obejít:
 *  - zamčená obrazovka ukazovala "Stream" a prázdný čtverec: název,
 *    tvůrce a obal si telefon bere od dokumentu, kterému patří přehrávaný
 *    zvuk - a to byl cizí iframe, ne Kine;
 *  - po zamknutí iPhone přehrávání zastavil (video v iframu) a rozjelo se
 *    až za chvíli samo.
 * Cloudflare Stream nabízí k videu i obyčejný HLS manifest, který umí
 * přehrát každý prohlížeč (Safari sám, ostatní přes hls.js). Tady jsou
 * čistá rozhodnutí bez prohlížeče - a mají test (tests/streamSource.test.mjs).
 *
 * KTERÝ PRVEK
 *
 * Safari (iPhone, iPad, Mac) umí HLS nativně a zvuk v <audio> hraje dál i
 * při zamčeném telefonu - přesně to, co se u hudby čeká. Obraz (režim
 * Video u hudby) dodá tichý <video> společník srovnaný podle zvuku.
 * Ostatní prohlížeče HLS nativně neumějí a jedou přes hls.js ve <video>,
 * které se v režimu Obal jen neukazuje.
 */

export type EngineKind = 'audio' | 'video';

/** Starší veřejná doména Cloudflare Stream - funguje pro každý účet. */
export const STREAM_FALLBACK_HOST = 'videodelivery.net';

/**
 * Kód zákazníka z adresy Cloudflare (customer-<kód>.cloudflarestream.com).
 * Nejčastěji ho appka zná z adresy náhledového obrázku videa.
 */
export function customerCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https?:\/\/customer-([a-z0-9]+)\.cloudflarestream\.com\//i.exec(url);
  return match ? match[1].toLowerCase() : null;
}

/** Adresa HLS manifestu - podle id videa, nebo podepsaného tokenu místo něj. */
export function manifestUrl(playbackId: string, customerCode: string | null | undefined): string {
  const host = customerCode ? `customer-${customerCode}.cloudflarestream.com` : STREAM_FALLBACK_HOST;
  return `https://${host}/${playbackId}/manifest/video.m3u8`;
}

/** <audio> tam, kde prohlížeč umí HLS sám (Safari); jinak <video> + hls.js. */
export function chooseEngineKind(nativeHls: boolean): EngineKind {
  return nativeHls ? 'audio' : 'video';
}

/** Nad tímhle rozdílem se společník srovná skokem... */
export const COMPANION_SEEK_DRIFT_S = 0.4;
/** ...pod ním jen mírně zrychlí či zpomalí, ať obraz neposkakuje. */
export const COMPANION_NUDGE_DRIFT_S = 0.08;

/**
 * Jak srovnat tichý obraz (společníka) se zvukem.
 * Kladný rozdíl = obraz je napřed.
 */
export function companionCorrection(audioTime: number, videoTime: number): { seekTo: number | null; rate: number } {
  const drift = videoTime - audioTime;
  if (!Number.isFinite(drift)) return { seekTo: null, rate: 1 };
  if (Math.abs(drift) > COMPANION_SEEK_DRIFT_S) return { seekTo: audioTime, rate: 1 };
  if (Math.abs(drift) > COMPANION_NUDGE_DRIFT_S) return { seekTo: null, rate: drift > 0 ? 0.97 : 1.03 };
  return { seekTo: null, rate: 1 };
}
