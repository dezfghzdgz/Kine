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

/** Ztlumená barva appky pro plochy a prstence (--brand-soft): "163, 79, 247" -> "rgba(163, 79, 247, 0.16)". */
export function brandSoftFrom(rgb: string): string {
  return `rgba(${rgb}, 0.16)`;
}

/**
 * Nastaví --brand, --brand-rgb a --brand-soft na <html>. Bez rozložitelné barvy
 * nechá složky být. --brand-soft dřív zůstávala tyrkysová i u jiné barvy appky
 * (zvýrazněné tlačítko na /plus, odznaky, prstence) - vypadalo to nedotaženě.
 */
export function applyBrandToDocument(color: string) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--brand', color);
  const rgb = hexToRgbTriplet(color);
  if (rgb) {
    root.setProperty('--brand-rgb', rgb);
    root.setProperty('--brand-soft', brandSoftFrom(rgb));
  } else {
    root.removeProperty('--brand-rgb');
    root.removeProperty('--brand-soft');
  }
}

/**
 * Skript do <head>: barva appky z minula hned při načtení - dřív stránka
 * na okamžik blikla výchozí tyrkysovou, než se barva nastavila z JavaScriptu.
 */
export const BRAND_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem('kine-brand-color');if(!c||!/^#[0-9a-f]{3,8}$/i.test(c))return;var r=document.documentElement.style;r.setProperty('--brand',c);var h=c.slice(1);if(h.length<6)h=h.slice(0,3).split('').map(function(x){return x+x}).join('');h=h.slice(0,6);var n=parseInt(h,16);var t=((n>>16)&255)+', '+((n>>8)&255)+', '+(n&255);r.setProperty('--brand-rgb',t);r.setProperty('--brand-soft','rgba('+t+', 0.16)')}catch(e){}})();`;
