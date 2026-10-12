/**
 * Odhad, kolik nahrávání ještě potrvá (proužek nahrávání). Čistá logika -
 * tests/uploadEta.test.mjs.
 */

/**
 * Zbývající vteřiny z dosavadního tempa. Až po pár vteřinách a pár
 * procentech - na začátku by odhad skákal. null = zatím nevíme.
 */
export function uploadEtaSeconds(percent: number, elapsedMs: number): number | null {
  if (!(percent >= 3 && percent < 100) || !(elapsedMs >= 4000)) return null;
  return Math.max(1, Math.round(((elapsedMs / percent) * (100 - percent)) / 1000));
}

/** Jak čas ukázat: vteřiny (po 5), minuty (nahoru), hodiny a minuty. */
export function etaParts(seconds: number): { unit: 's'; n: number } | { unit: 'min'; n: number } | { unit: 'h'; h: number; m: number } {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return { unit: 's', n: Math.max(5, Math.ceil(s / 5) * 5) };
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) return { unit: 'min', n: minutes };
  return { unit: 'h', h: Math.floor(minutes / 60), m: minutes % 60 };
}
