/**
 * Pruh Sparks mezi videi (components/SparksShelf.tsx): kolik karet do
 * řádku, aby řádek vyplnil celou šířku. Čistá logika (tests/sparksShelf.test.mjs).
 */

export const SHELF_GAP_PX = 16;
/** Nejmenší karta na počítači (užší okno trochu menší), největší, když je Sparks málo. */
const MIN_WIDE_PX = 200;
const MIN_NARROW_PX = 160;
const MAX_PX = 280;

/**
 * Sloupce a řádky, které se ukážou hned (zbytek za "Zobrazit víc").
 * Telefon: 2 vedle sebe, dva řádky. Jinak jeden řádek přes celou šířku:
 * tolik karet, kolik se vejde (nejmenší 200 px); když je Sparks míň,
 * karty se zvětší, ale nejvýš na 280 px - zbytek řádku pak zůstane prázdný.
 */
export function sparksShelfColumns(width: number, count: number): { cols: number; rows: number } {
  if (!Number.isFinite(width) || width <= 0) return { cols: 2, rows: 1 };
  if (width < 520) return { cols: 2, rows: 2 };
  const min = width >= 1100 ? MIN_WIDE_PX : MIN_NARROW_PX;
  const fit = Math.max(1, Math.floor((width + SHELF_GAP_PX) / (min + SHELF_GAP_PX)));
  const atLeast = Math.max(1, Math.ceil((width + SHELF_GAP_PX) / (MAX_PX + SHELF_GAP_PX)));
  const cols = Math.min(fit, Math.max(Math.min(fit, Math.max(1, count)), atLeast));
  return { cols, rows: 1 };
}
