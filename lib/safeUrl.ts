/**
 * Odkazy, které do appky napsal někdo jiný.
 *
 * Odkazy na profilu (Instagram, web, ...) si každý píše sám a pak je vidí
 * návštěvníci jeho kanálu. React sám o sobě nehlídá, co je v href - dá se
 * tam tedy napsat "javascript:..." a komukoliv, kdo na odznak klikne,
 * spustit vlastní kód v jeho přihlášeném prohlížeči. To je krádež účtu na
 * jedno kliknutí, a když se trefí do moderátora, tak i jeho práv.
 *
 * Proto se pouštějí jen odkazy, kam se dá opravdu jít: http a https.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Vrátí odkaz, pokud je bezpečný, jinak null.
 *
 * Odkaz bez schématu ("instagram.com/nekdo") se schválně doplní na https -
 * lidi ho tak píšou nejčastěji a odmítnout ho by bylo zbytečně přísné.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    return ALLOWED_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    // Nesmysl místo odkazu - radši nic než něco, co se chová nečekaně.
    return null;
  }
}
