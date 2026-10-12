/**
 * Sparks (krátká svislá videa, /sparks) - kdy které video napojit,
 * přednačíst a jak velké. Čistá rozhodnutí bez prohlížeče
 * (tests/sparksPlayback.test.mjs).
 *
 * PROČ SE SPARKS NAČÍTALY DÉL NEŽ DLOUHÁ VIDEA
 *
 * Každá karta hrála v iframu Cloudflare: ten si nejdřív stáhne vlastní
 * stránku a skript přehrávače, pak seznam kvalit, pak první kus - a pustit
 * ho šlo až přes SDK, které se načítalo líně (až po načtení celé stránky).
 * K tomu si každá z ~80 karet hned po otevření sama stahovala přihlášení,
 * profil, lajky a komentáře (stovky dotazů naráz).
 *
 * Teď hraje <video> s HLS od Cloudflare (Safari sám, ostatní hls.js -
 * lib/vodPlayer.ts, stejně jako stránka videa):
 *  - první kus v nižší kvalitě, kvalita pak sama vyskočí,
 *  - další dvě videa v řadě se přednačítají (první kus), předchozí zůstává
 *    napojené - přejetí prstem je okamžité,
 *  - přednačítání začne až když se rozjede to, na které se díváš (jinak by
 *    mu bralo data),
 *  - lajky, komentáře a odběr jen u karet poblíž,
 *  - když vlastní přehrávač nejde, karta přepne na iframe Cloudflare.
 */

export type SparkEngine = 'native' | 'iframe';

/** Přednačítané video (další v řadě): tolik vteřin dopředu - zhruba první kus. */
export const SPARK_PRELOAD_BUFFER_S = 4;
/** Video, které hraje: dopředu jako u ostatních videí. */
export const SPARK_ACTIVE_BUFFER_S = 30;
/** Za sebou celé (Sparks mají nejvýš 2 minuty) - smyčka pak nic nestahuje znovu. */
export const SPARK_BACK_BUFFER_S = 120;
/** Pojistka: kdyby se první video nerozjelo (pomalá síť, zákaz přehrávání), přednačítání začne aspoň po téhle době. */
export const SPARK_WARM_FALLBACK_MS = 2500;

export type SparkSlot = {
  /** Napojit video: hraje, nebo se přednačítá. */
  attach: boolean;
  /** Karta je blízko: náhled a počty (lajky, komentáře, odběr). */
  near: boolean;
};

/**
 * Co dělat s kartou na pozici `index`, když se díváš na `active`.
 *
 * Než se rozjede první video (warm = false), nenapojuje se nic jiného -
 * přednačítání by mu bralo data. Pak jedno za sebou (návrat zpět bez
 * čekání) a dvě dopředu; při šetření dat jen jedno dopředu. Iframe
 * Cloudflare je těžký - jen další jedno, jako dřív.
 */
export function sparkSlot(index: number, active: number, opts: { engine: SparkEngine | null; warm: boolean; saveData?: boolean }): SparkSlot {
  const d = index - active;
  const near = Math.abs(d) <= 3;
  if (!opts.engine) return { attach: false, near };
  if (d === 0) return { attach: true, near: true };
  if (!opts.warm) return { attach: false, near };
  if (opts.engine === 'iframe') return { attach: d === 1, near };
  return { attach: d >= -1 && d <= (opts.saveData ? 1 : 2), near };
}

/**
 * Náhled karty (než se video rozjede, a u karet poblíž). Náhled od
 * Cloudflare bez velikosti je v plném rozlišení videa - stačí menší.
 */
export function sparkPoster(video: { thumbnail_url?: string | null; cloudflare_video_id?: string | null }): string | null {
  const url = typeof video.thumbnail_url === 'string' ? video.thumbnail_url.trim() : '';
  if (/^https:\/\//i.test(url)) {
    if (/cloudflarestream\.com\/|videodelivery\.net\//i.test(url) && /\/thumbnails\/thumbnail\.jpg/i.test(url) && !/[?&]height=/i.test(url)) {
      return `${url}${url.includes('?') ? '&' : '?'}height=720`;
    }
    return url;
  }
  if (video.cloudflare_video_id) return `https://videodelivery.net/${encodeURIComponent(video.cloudflare_video_id)}/thumbnails/thumbnail.jpg?height=720`;
  return null;
}

/**
 * Prohlížeč odmítl play(): co dál.
 *  - zákaz zvuku bez klepnutí (NotAllowedError, se zvukem) -> zkusit potichu,
 *  - zákaz i potichu (úsporný režim, nastavení prohlížeče) -> tlačítko Přehrát,
 *  - cokoli jiného (přerušené načítání...) -> nic, zkusí se to znovu.
 */
export function afterPlayRejected(errorName: string | null | undefined, muted: boolean): 'retry-muted' | 'needs-tap' | 'ignore' {
  if (errorName !== 'NotAllowedError') return 'ignore';
  return muted ? 'needs-tap' : 'retry-muted';
}

/** Kdy znovu zkusit play(), než se video rozjede (ms od zapnutí karty) - záloha k událostem přehrávače. */
export const SPARK_PLAY_RETRY_MS = [150, 400, 900, 1600, 2600, 4000, 6500];
