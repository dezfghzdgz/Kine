/**
 * Barva appky (--brand) a její rozklad na složky (--brand-rgb).
 *
 * Sklo (app/globals.css, oddíl KINE GLASS) potřebuje barvu appky
 * s průhledností - tint stisku, prstenec pole. CSS umí "rgba(r, g, b, a)"
 * všude, ale ze samotného "#a34ff7" složky nevytáhne (color-mix neznají
 * starší televize). Proto se vedle --brand nastavuje i --brand-rgb
 * jako "163, 79, 247". Rozklad je tady, ať se dá otestovat.
 */

/** "#a34ff7" nebo "#af7" -> "163, 79, 247". Neplatná barva -> null. */
export function hexToRgbTriplet(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3 || raw.length === 4
      ? raw.slice(0, 3).split('').map((ch) => ch + ch).join('')
      : raw.length === 6 || raw.length === 8
        ? raw.slice(0, 6)
        : null;
  if (!full || !/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Nastaví --brand i --brand-rgb na <html>. Bez rozložitelné barvy nechá --brand-rgb být. */
export function applyBrandToDocument(color: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--brand', color);
  const rgb = hexToRgbTriplet(color);
  if (rgb) root.setProperty('--brand-rgb', rgb);
  else root.removeProperty('--brand-rgb');
}
