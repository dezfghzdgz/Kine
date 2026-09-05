/**
 * Navigace šipkami po stránce - pro dálkový ovladač.
 *
 * Prohlížeč v televizi posílá šipky ovladače jako klávesy, ale sám o sobě
 * s nimi jen posouvá stránku. Tohle z nich dělá to, co divák čeká od
 * každé televizní appky: výběr přeskakuje mezi prvky tím směrem, kam se
 * zmáčklo, OK otevře, Zpět vrátí.
 *
 * GEOMETRIE (čistá, s testem: tests/spatialNav.test.mjs)
 *
 * Kandidáti jsou prvky, které leží v daném směru od aktuálního (jejich
 * bližší hrana je za vzdálenější hranou aktuálního, s malou tolerancí).
 * Vybere se ten s nejmenší "cenou": vzdálenost ve směru pohybu plus
 * dvojnásobek vybočení do strany. Prvky, které se s aktuálním překrývají
 * ve směru kolmém (jsou "v jedné řadě"), mají přednost - proto šipka
 * doprava přeskočí na sousední kartu a ne na něco šikmo dole.
 *
 * DOM (dole)
 *
 * Fokusovatelné prvky se berou z celé stránky, ale karta videa se počítá
 * jako jeden cíl (má v sobě odkaz na náhled, odkaz na název i tlačítko ⋮;
 * skákat po třech místech na jedné kartě by bylo únavné). Šipky se
 * nepřebírají v textových polích (tam posouvají kurzor) a v přehrávači,
 * když je vybraný (tam posouvají video).
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Candidate<T = unknown> {
  rect: Rect;
  item: T;
}

/** Jak moc smí kandidát "lézt" zpátky přes hranu aktuálního prvku. */
const EDGE_TOLERANCE = 4;

function center(r: Rect) {
  return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
}

function overlaps(a: Rect, b: Rect, axis: 'x' | 'y'): boolean {
  return axis === 'x'
    ? a.left < b.right && b.left < a.right
    : a.top < b.bottom && b.top < a.bottom;
}

/** Je kandidát v daném směru od aktuálního prvku? */
export function isInDirection(from: Rect, to: Rect, dir: Direction): boolean {
  switch (dir) {
    case 'right': return to.left >= from.right - EDGE_TOLERANCE && to.left > from.left;
    case 'left': return to.right <= from.left + EDGE_TOLERANCE && to.right < from.right;
    case 'down': return to.top >= from.bottom - EDGE_TOLERANCE && to.top > from.top;
    case 'up': return to.bottom <= from.top + EDGE_TOLERANCE && to.bottom < from.bottom;
  }
}

/**
 * Cena přechodu: čím menší, tím lepší. Vzdálenost ve směru pohybu +
 * 2× vybočení do strany; prvky v jedné řadě/sloupci dostanou slevu.
 */
export function moveCost(from: Rect, to: Rect, dir: Direction): number {
  const fc = center(from);
  const tc = center(to);
  const horizontal = dir === 'left' || dir === 'right';

  const primary = horizontal
    ? (dir === 'right' ? to.left - from.right : from.left - to.right)
    : (dir === 'down' ? to.top - from.bottom : from.top - to.bottom);
  const secondary = horizontal ? Math.abs(tc.y - fc.y) : Math.abs(tc.x - fc.x);
  const aligned = overlaps(from, to, horizontal ? 'y' : 'x');

  return Math.max(0, primary) + secondary * 2 + (aligned ? 0 : 1000);
}

/** Nejlepší cíl v daném směru, nebo null, když tam nic není. */
export function pickNext<T>(from: Rect, candidates: Candidate<T>[], dir: Direction): Candidate<T> | null {
  let best: Candidate<T> | null = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    if (!isInDirection(from, c.rect, dir)) continue;
    const cost = moveCost(from, c.rect, dir);
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}

/** Klávesa ovladače -> směr. Zahrnuje kódy Tizen/webOS, které nemají jméno. */
export function directionOfKey(key: string, keyCode: number): Direction | null {
  switch (key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
  }
  switch (keyCode) {
    case 38: return 'up';
    case 40: return 'down';
    case 37: return 'left';
    case 39: return 'right';
  }
  return null;
}

/** Tlačítko Zpět na ovladači: Tizen 10009, webOS 461, jinak Escape/Backspace. */
export function isBackKey(key: string, keyCode: number): boolean {
  return key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'BrowserBack' || keyCode === 10009 || keyCode === 461;
}

/* ---------- DOM ---------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Prvky, které se na kartě/odkazu počítají jako jeden cíl. */
const GROUP = '.video-card, .sidebar-link, .mobile-nav-item, .playlist-panel-item, .continue-row > *, .player-wrap';

function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
  if (el.closest('[aria-hidden="true"], [hidden]')) return false;
  return true;
}

export function collectCandidates(root: ParentNode = document): Candidate<HTMLElement>[] {
  const seenGroups = new Set<Element>();
  const out: Candidate<HTMLElement>[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))) {
    if (!isVisible(el)) continue;
    const group = el.closest(GROUP);
    if (group) {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
      const r = group.getBoundingClientRect();
      out.push({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, item: el });
      continue;
    }
    const r = el.getBoundingClientRect();
    out.push({ rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, item: el });
  }
  return out;
}

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/**
 * Zapne obsluhu šipek. Vrací funkci, která ji vypne.
 *
 * `shouldHandle` řekne, jestli právě teď (podle zaměřeného prvku) máme
 * šipky brát my - přehrávač si je nechává, když je vybraný.
 */
export function installSpatialNavigation(opts: {
  isActive: () => boolean;
  shouldHandle?: (active: Element | null, dir: Direction) => boolean;
}): () => void {
  function onKeyDown(e: KeyboardEvent) {
    if (!opts.isActive()) return;
    if (e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const active = document.activeElement;

    if (isBackKey(e.key, e.keyCode)) {
      // Zpět: nejdřív zavřít, co je otevřené (dialog, celá obrazovka)
      // - to řeší stránky samy přes Escape. Když nic není, o stránku zpět.
      if (e.key === 'Escape' || e.key === 'Backspace') {
        if (isTyping(active)) return;
        if (e.key === 'Backspace') {
          e.preventDefault();
          history.back();
        }
        return;
      }
      e.preventDefault();
      history.back();
      return;
    }

    const dir = directionOfKey(e.key, e.keyCode);
    if (!dir) return;
    if (isTyping(active) && (dir === 'left' || dir === 'right')) return;
    if (opts.shouldHandle && !opts.shouldHandle(active, dir)) return;

    const candidates = collectCandidates();
    if (candidates.length === 0) return;

    let target: HTMLElement | null = null;
    const activeEl = active && active !== document.body ? (active as HTMLElement) : null;

    if (!activeEl) {
      // Nic není vybrané - první šipka vybere první kartu/odkaz v obsahu.
      const main = document.querySelector('main, .content-area, .content-area-fullbleed');
      const inMain = main ? candidates.filter((c) => main.contains(c.item)) : candidates;
      const pool = inMain.length > 0 ? inMain : candidates;
      target = pool.slice().sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)[0]?.item ?? null;
    } else {
      const fromGroup = activeEl.closest(GROUP);
      const fromRect = (fromGroup ?? activeEl).getBoundingClientRect();
      const others = candidates.filter((c) => c.item !== activeEl && !(fromGroup && fromGroup.contains(c.item)));
      target = pickNext(fromRect, others, dir)?.item ?? null;
    }

    if (!target) return;
    e.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
