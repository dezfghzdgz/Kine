/**
 * Přehrávač živého vysílání (components/LivePlayer.tsx) - čistá pravidla,
 * ať jdou vyzkoušet bez prohlížeče (tests/livePlayback.test.mjs).
 *
 * Divák občas viděl jen zamrzlý první snímek a nic se nedělo (přehrávač
 * Cloudflare se po startu vysílání zasekl, nebo ho prohlížeč nepustil se
 * zvukem). Stránka teď hlídá, jestli obraz opravdu běží (čas přehrávače
 * roste). Když LIVE_STALL_MS stojí, přehrávač se načte znovu - napoprvé
 * hned, další pokusy s rostoucím odstupem (výpadek vysílání nemá stránku
 * zahltit obnovami).
 */

/** Jak dlouho smí obraz stát (čas přehrávače neroste), než se přehrávač načte znovu. */
export const LIVE_STALL_MS = 20 * 1000;

/** Odstup od minulé obnovy podle toho, kolikátá je (pak už pořád ten poslední). */
export const LIVE_RELOAD_GAPS_MS = [0, 30 * 1000, 60 * 1000, 120 * 1000];

export type StallInput = {
  now: number;
  /** Kdy naposledy čas přehrávače postoupil (nebo kdy se přehrávač načetl). */
  lastProgressAt: number;
  /** Kdy se přehrávač naposledy načetl znovu (0 = ještě ne). */
  lastReloadAt: number;
  /** Kolikrát už se načetl znovu, aniž by se obraz rozjel. */
  reloads: number;
  /** Pauzu dal divák sám - pak se nic neobnovuje. */
  pausedByViewer: boolean;
  /** Karta je vidět (na pozadí prohlížeč přehrávání schválně brzdí). */
  visible: boolean;
};

export function stallAction(s: StallInput): 'none' | 'reload' {
  if (!s.visible || s.pausedByViewer) return 'none';
  if (s.now - s.lastProgressAt < LIVE_STALL_MS) return 'none';
  const gap = LIVE_RELOAD_GAPS_MS[Math.min(Math.max(0, s.reloads), LIVE_RELOAD_GAPS_MS.length - 1)];
  return s.now - s.lastReloadAt >= gap ? 'reload' : 'none';
}

/** Přehrávač vstupu na doméně zákazníka (hraje, co na vstupu zrovna běží - i další přenos). */
const INPUT_PLAYER = /^https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/[a-z0-9]+\/iframe/i;

/**
 * Jakou adresu přehrávače nechat, když server pošle novou (stránka se ptá
 * každých 6 s). Jiná adresa = iframe se načte znovu, proto:
 *  - z náhradní adresy (video podle id) na přehrávač vstupu ano (lepší),
 *  - z přehrávače vstupu zpátky na náhradní ne - kdyby server jednou kód
 *    zákazníka nenašel, divákovi by se přenos zbytečně načítal pořád dokola,
 *  - jinak nová adresa (nový přenos).
 */
export function nextPlayerUrl(current: string | null, incoming: string | null): string | null {
  if (!incoming) return current;
  if (!current || current === incoming) return incoming;
  if (INPUT_PLAYER.test(current) && !INPUT_PLAYER.test(incoming)) return current;
  return incoming;
}

/** Adresa přehrávače po n-té obnově (jiná adresa = prohlížeč iframe opravdu načte znovu). */
export function livePlayerSrc(url: string, reload: number): string {
  if (!reload || reload < 1) return url;
  return `${url}${url.includes('?') ? '&' : '?'}kr=${Math.floor(reload)}`;
}

/**
 * Postoupil čas přehrávače? U živého vysílání čas roste, dokud obraz běží;
 * při zaseknutí stojí. Skok zpět (přehrávač se načetl znovu) není postup.
 */
export function timeAdvanced(previous: number | null, current: number): boolean {
  if (!Number.isFinite(current)) return false;
  return previous !== null && Number.isFinite(previous) && current > previous + 0.05;
}
