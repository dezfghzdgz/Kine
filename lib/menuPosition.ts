/**
 * Kam s vyskakovací nabídkou (⋮ u karty videa - components/VideoCardMenu.tsx).
 *
 * Nabídka je v <body> a pevně k oknu (position: fixed). Dřív visela uvnitř
 * karty a řady, které se posouvají do strany (Pokračovat ve sledování,
 * Sparks), ji ořízly - horní položky nebyly vidět. Teď: nad tečky, když se
 * tam vejde (nebo je nad nimi víc místa), jinak pod ně; zarovnaná k pravému
 * kraji teček a nikdy přes okraj okna. Výška se zkrátí na volné místo
 * (zbytek se v nabídce posouvá).
 */

export const PANEL_WIDTH = 244;
export const PANEL_MAX_HEIGHT = 340;
const PANEL_GAP = 6;
const VIEWPORT_MARGIN = 8;

export type PanelPos = { top: number | null; bottom: number | null; left: number; maxHeight: number };

export function panelPosition(btn: { top: number; bottom: number; right: number }, panelHeight: number, vw: number, vh: number): PanelPos {
  const wanted = Math.min(Math.max(Number.isFinite(panelHeight) ? panelHeight : PANEL_MAX_HEIGHT, 0), PANEL_MAX_HEIGHT);
  const above = btn.top - PANEL_GAP - VIEWPORT_MARGIN;
  const below = vh - btn.bottom - PANEL_GAP - VIEWPORT_MARGIN;
  const up = above >= wanted || above > below;
  const room = Math.max(120, up ? above : below);
  const left = Math.min(Math.max(btn.right - PANEL_WIDTH, VIEWPORT_MARGIN), Math.max(VIEWPORT_MARGIN, vw - PANEL_WIDTH - VIEWPORT_MARGIN));
  const maxHeight = Math.min(PANEL_MAX_HEIGHT, room);
  return up
    ? { top: null, bottom: Math.max(VIEWPORT_MARGIN, vh - btn.top + PANEL_GAP), left, maxHeight }
    : { top: Math.max(VIEWPORT_MARGIN, btn.bottom + PANEL_GAP), bottom: null, left, maxHeight };
}
