/**
 * Kanonická adresa /api/badges/stats - čistá logika (tests/apiHardening.test.mjs).
 *
 * Odpověď drží 5 minut CDN, ale jen pro přesně stejnou adresu. Dřív stačilo
 * přidat "&x=<náhodné>" (nebo id kanálu velkými písmeny) a každý požadavek šel
 * mimo mezipaměť rovnou do databáze (desítka dotazů) - a brzda hlídala jen
 * ?fresh=1. Teď má každá odpověď jedinou adresu; jiný tvar se přesměruje
 * na ni (přesměrování nestojí žádný dotaz do databáze).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Parametry, které si do adresy může přidat sám Next (přepisy) - kvůli nim se nepřesměrovává. */
const INTERNAL = /^nxt[PI]/;

/**
 * ok: false = neplatný kanál. Jinak kanonický dotaz ("?channel=<id>" nebo
 * "?channel=<id>&fresh=1") a jestli na něj přesměrovat (adresa má jiný tvar).
 */
export function badgeStatsQuery(params: URLSearchParams): { ok: false } | { ok: true; canonical: string; redirect: boolean } {
  const channel = (params.get('channel') ?? '').trim();
  if (!UUID.test(channel)) return { ok: false };
  const canonical = `?channel=${channel.toLowerCase()}${params.get('fresh') === '1' ? '&fresh=1' : ''}`;
  const actual = [...params.entries()]
    .filter(([key]) => !INTERNAL.test(key))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return { ok: true, canonical, redirect: `?${actual}` !== canonical };
}
