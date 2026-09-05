/**
 * Mini přehrávač na stránce videa (app/watch/[id]/page.tsx).
 *
 * Když divák odroluje pod video - ke komentářům, k dalším videím - přehrávač
 * se zmenší do rohu a hraje dál, místo aby zmizel nahoře za okrajem. Zpátky
 * do krabice se vrátí sám, jakmile je krabice zase vidět.
 *
 * Tady je jen rozhodnutí "má být mini?", bez prohlížeče, aby šlo otestovat.
 * Měření (kolik z krabice je vidět a kde je) dodává IntersectionObserver.
 */

/** Pod tuhle viditelnou část krabice se přehrávač zmenší do rohu. */
export const MINI_PLAYER_HIDE_RATIO = 0.3;

export type MiniPlayerInput = {
  /** Viditelná část krabice přehrávače, 0 až 1. */
  ratio: number;
  /** Horní hrana krabice vůči oknu (záporná = odrolovaná nahoru). */
  top: number;
  /** Divák mini přehrávač zavřel křížkem - neotravovat, dokud krabici zase neuvidí. */
  dismissed: boolean;
  /** Režim televize: ovladač se posouvá po prvcích, plovoucí okno by mátlo výběr. */
  tv: boolean;
  /** Hudba má vlastní přehrávač v kostře appky, stránka žádný nevlastní. */
  musicMode: boolean;
};

export type MiniPlayerDecision = {
  /** Krabice je (dost) vidět, nebo je pod oknem - přehrávač patří do ní. */
  boxVisible: boolean;
  /** Zmenšit do rohu. */
  mini: boolean;
};

export function decideMiniPlayer(input: MiniPlayerInput): MiniPlayerDecision {
  // Pod okno se krabice na stránce videa nedostane (je nahoře), ale kdyby
  // ano - třeba po skoku na komentář z odkazu - mini okno by přehrávač
  // jen zdvojilo. Mini je jen pro krabici odrolovanou NAHORU.
  const boxVisible = input.ratio >= MINI_PLAYER_HIDE_RATIO || input.top >= 0;
  const mini = !boxVisible && !input.dismissed && !input.tv && !input.musicMode;
  return { boxVisible, mini };
}

/** Kam skočit číslicí 0-9: na desetinu délky (jako na YouTube). */
export function digitSeekTarget(digit: number, duration: number): number | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  return (digit / 10) * duration;
}
