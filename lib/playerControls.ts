/**
 * Rozhodování ovládací lišty přehrávače - bez Reactu a bez prohlížeče.
 *
 * Lišta sama je components/ChapterTimeline.tsx a tohle jen napojuje na
 * obrazovku. Co se dá spočítat čistě (čas, kam se klepnulo, jestli je to
 * dvojité klepnutí, co udělat při otočení telefonu), je tady, aby se to
 * dalo otestovat: tests/playerControls.test.mjs.
 */

/** Po jaké době bez pohybu se lišta schová (jen když video hraje). */
export const AUTO_HIDE_MS = 3000;

/** Dvě klepnutí do téhle doby jsou dvojité klepnutí. */
export const DOUBLE_TAP_MS = 320;

/** O kolik posune dvojité klepnutí na kraj videa. */
export const DOUBLE_TAP_SEEK_S = 10;

/**
 * Čas jako na YouTube: 0:07, 4:05, 1:02:03.
 * Záporné, NaN a nekonečno se berou jako nula - přehrávač je občas hlásí,
 * než se dozví skutečnou délku.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export type TapSide = 'left' | 'center' | 'right';

/**
 * Do které části videa se klepnulo. Kraje jsou po 35 %, střed zbytek -
 * dvojité klepnutí do středu nemá posouvat, tam si člověk jen zastavuje.
 */
export function tapSide(x: number, width: number): TapSide {
  if (!(width > 0)) return 'center';
  const f = x / width;
  if (f < 0.35) return 'left';
  if (f > 0.65) return 'right';
  return 'center';
}

export interface Tap {
  time: number;
  side: TapSide;
}

export type TapDecision =
  | { kind: 'single'; side: TapSide }
  | { kind: 'double'; side: TapSide; seekBy: number };

/**
 * Jedno nebo dvojité klepnutí?
 *
 * Dvojité je, když přišlo do DOUBLE_TAP_MS po předchozím a na stejnou
 * stranu. Vlevo posouvá zpět, vpravo dopředu, uprostřed se dvojité
 * klepnutí bere jako další jednoduché - přehrávat/pauza dvakrát za sebou
 * je přesně to, co člověk uprostřed čekal.
 */
export function decideTap(previous: Tap | null, current: Tap): TapDecision {
  const isDouble =
    previous !== null &&
    current.time - previous.time <= DOUBLE_TAP_MS &&
    previous.side === current.side &&
    current.side !== 'center';

  if (!isDouble) return { kind: 'single', side: current.side };

  return {
    kind: 'double',
    side: current.side,
    seekBy: current.side === 'left' ? -DOUBLE_TAP_SEEK_S : DOUBLE_TAP_SEEK_S,
  };
}

/**
 * Cílový čas po posunu - drží se v rozsahu videa. Když délku ještě neznáme
 * (0), omezí jen zdola.
 */
export function clampSeek(target: number, duration: number): number {
  if (!Number.isFinite(target)) return 0;
  const lower = Math.max(0, target);
  return duration > 0 ? Math.min(lower, duration) : lower;
}

export interface OrientationInputs {
  /** Telefon na šířku: dotyk, orientace landscape, nízká obrazovka. */
  landscapePhone: boolean;
  /** Přehrávač je teď na celé obrazovce (skutečné nebo náhradní). */
  isFullscreen: boolean;
  /** Na celou obrazovku ho dostalo otočení, ne člověk tlačítkem. */
  autoEntered: boolean;
}

export type OrientationDecision = 'enter' | 'exit' | 'keep';

/**
 * Otočení telefonu na šířku = celá obrazovka, zpátky na výšku = zpátky do
 * stránky. Jako YouTube.
 *
 * Do celé obrazovky se vstupuje jen na šířku a jen když tam video ještě
 * není. Ven se jde jen z toho, co otočení samo zapnulo: když si člověk
 * dal celou obrazovku sám tlačítkem, otočení na výšku mu ji nesmí sebrat.
 * Tablety se neřeší vůbec - na šířku je to u nich normální rozložení.
 */
export function decideOrientationFullscreen(i: OrientationInputs): OrientationDecision {
  if (i.landscapePhone) {
    return i.isFullscreen ? 'keep' : 'enter';
  }
  return i.isFullscreen && i.autoEntered ? 'exit' : 'keep';
}
