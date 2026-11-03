/**
 * Náhoda, která neskáče.
 *
 * Doporučování potřebuje kousek náhody (ať se feed nehrne pořád stejně),
 * ale Math.random() při každém obnovení stránky přeházel celé pořadí -
 * divák dal F5 a všechno bylo jinde. Tady je náhoda odvozená z "semínka":
 * stejný divák a stejné semínko = stejné pořadí. Semínko se drží ~30 minut
 * (sessionSeed), pak přijde nové a feed se znovu promíchá.
 *
 * Čisté funkce (bez prohlížeče) mají test: tests/feedFilters.test.mjs.
 */

/** Jak dlouho platí jedno semínko (jedno "posezení"). */
export const SEED_WINDOW_MS = 30 * 60 * 1000;

/** Krátký stabilní otisk textu (FNV-1a, 32 bitů). */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Promíchání otisku se semínkem (murmur3 fmix32) - každé semínko úplně jiné pořadí. */
export function mixSeed(h: number, seed: number): number {
  let x = (h ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** Číslo 0 až 1 (bez 1) pro daný klíč (třeba id videa) a semínko - pořád stejné. */
export function seededUnit(seed: number, key: string): number {
  return mixSeed(hashText(key), seed) / 4294967296;
}

/** Semínko pro diváka v daném časovém okně (bez úložiště - třeba na serveru). */
export function viewerSeed(viewerKey: string, now: number = Date.now(), windowMs: number = SEED_WINDOW_MS): number {
  const slot = Math.floor(now / Math.max(1, windowMs));
  return mixSeed(hashText(viewerKey || 'anon'), slot);
}

/** Generátor čísel 0-1 ze semínka (mulberry32) - na míchání. */
export function seededGenerator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zamíchání (Fisher-Yates) se semínkem. Dřív se míchalo přes
 * sort(() => Math.random() - 0.5) - to není rovnoměrné (některá pořadí
 * vycházejí mnohem častěji) a při každém obnovení jiné.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = seededGenerator(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// --- Prohlížeč -------------------------------------------------------------

const VIEWER_KEY = 'kine-viewer-key';
const SEED_KEY = 'kine-feed-seed';

/** Náhodné id prohlížeče pro nepřihlášené (jen na semínko, nikam se neposílá). */
export function anonViewerKey(): string {
  if (typeof window === 'undefined') return 'anon';
  try {
    const stored = window.localStorage.getItem(VIEWER_KEY);
    if (stored && /^[a-z0-9]{8,40}$/.test(stored)) return stored;
    const fresh = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    window.localStorage.setItem(VIEWER_KEY, fresh);
    return fresh;
  } catch {
    return 'anon';
  }
}

/** Je uložené semínko pořád platné? (čisté - test) */
export function storedSeedValid(stored: unknown, viewerKey: string, now: number, windowMs: number = SEED_WINDOW_MS): stored is { s: number; at: number; k: string } {
  if (!stored || typeof stored !== 'object') return false;
  const o = stored as { s?: unknown; at?: unknown; k?: unknown };
  if (typeof o.s !== 'number' || !Number.isFinite(o.s) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return false;
  if (o.k !== viewerKey) return false;
  return now >= o.at && now - o.at < windowMs;
}

/**
 * Semínko na jedno posezení: platí ~30 minut od chvíle, kdy vzniklo (ne od
 * poslední návštěvy - jinak by se feed tomu, kdo chodí často, nepromíchal
 * nikdy). Sdílí se mezi kartami prohlížeče. Bez úložiště se vezme okno času.
 */
export function sessionSeed(viewerKey: string, now: number = Date.now()): number {
  if (typeof window === 'undefined') return viewerSeed(viewerKey, now);
  try {
    const stored = JSON.parse(window.localStorage.getItem(SEED_KEY) ?? 'null');
    if (storedSeedValid(stored, viewerKey, now)) return stored.s >>> 0;
    const s = (viewerSeed(viewerKey, now) ^ Math.floor(Math.random() * 4294967296)) >>> 0;
    window.localStorage.setItem(SEED_KEY, JSON.stringify({ s, at: now, k: viewerKey }));
    return s;
  } catch {
    return viewerSeed(viewerKey, now);
  }
}
