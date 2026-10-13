/**
 * Spojení se servery, odkud Kine stahuje data a videa, se naváže co nejdřív.
 *
 * Na mobilních datech stojí nové spojení (DNS, TCP, TLS) klidně půl vteřiny
 * i víc - a dřív se navazovalo až ve chvíli, kdy si o první data řekla
 * stránka (Supabase), nebo o náhled a video karta (Cloudflare,
 * customer-<kód>.cloudflarestream.com). Teď:
 *  - Supabase: <link rel="preconnect"> přímo v hlavičce (app/layout.tsx),
 *  - Cloudflare: kód zákazníka (z adresy náhledu videa) si prohlížeč
 *    zapamatuje a skript v hlavičce (NETWORK_HINTS_BOOT_SCRIPT) spojení
 *    naváže hned při příštím načtení - ještě než se stáhne JavaScript.
 */

export const STREAM_CODE_KEY = 'kine-stream-code';

/** Zapamatuje kód zákazníka Cloudflare (customer-<kód>.cloudflarestream.com). */
export function rememberStreamCode(code: string | null | undefined): void {
  if (!code || !/^[a-z0-9]{6,40}$/i.test(code) || typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(STREAM_CODE_KEY) !== code) window.localStorage.setItem(STREAM_CODE_KEY, code);
  } catch {
    // bez úložiště se spojení naváže až s prvním náhledem
  }
}

/**
 * Skript do <head>: s kódem z minula naváže spojení s Cloudflare hned -
 * jednou "anonymně" (hls.js stahuje video přes CORS) a jednou normálně
 * (obrázky náhledů, Safari přehrává video sám).
 */
export const NETWORK_HINTS_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem(${JSON.stringify(STREAM_CODE_KEY)});if(!c||!/^[a-z0-9]{6,40}$/i.test(c))return;var h='https://customer-'+c+'.cloudflarestream.com';[true,false].forEach(function(a){var l=document.createElement('link');l.rel='preconnect';l.href=h;if(a)l.crossOrigin='anonymous';document.head.appendChild(l);});}catch(e){}})();`;
