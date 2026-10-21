/**
 * Co nabídnout po konci videa (a v pořadí vedle videa): pořád něco nového.
 *
 * Dřív se po konci nabízela prostě nejnovější videa na Kine - klidně ta,
 * která divák už viděl. Teď:
 *  - po konci videa (odpočet, automatické pokračování) jen videa, která
 *    divák ještě neviděl - podle historie na účtu (watch_history) i podle
 *    paměti prohlížeče (funguje i bez přihlášení);
 *  - příbuzná napřed: stejná kategorie, stejný tvůrce; jinak nejnovější;
 *  - v seznamu vedle videa nezhlédnutá napřed, zhlédnutá až za nimi.
 * Když už divák viděl všechno, po konci se nenabídne nic (žádné opakování).
 * Fronta a další video z playlistu mají přednost dál - ty si vybral sám.
 *
 * Čisté funkce (bez prohlížeče) mají test: tests/upNext.test.mjs.
 */

export type UpNextCandidate = {
  id: string;
  owner_id?: string | null;
  category?: string | null;
};

export type CurrentVideo = {
  id: string;
  owner_id?: string | null;
  category?: string | null;
};

/** Nezhlédnutá videa k pokračování: příbuzná napřed, jinak v původním pořadí (od nejnovějšího). */
export function rankUpNext<T extends UpNextCandidate>(candidates: readonly T[], current: CurrentVideo, seen: ReadonlySet<string>): T[] {
  const fresh = candidates
    .map((video, index) => ({ video, index }))
    .filter(({ video }) => !!video && !!video.id && video.id !== current.id && !seen.has(video.id));
  const score = (v: T) =>
    (current.category && v.category === current.category ? 2 : 0) + (current.owner_id && v.owner_id === current.owner_id ? 1 : 0);
  return fresh
    .sort((a, b) => score(b.video) - score(a.video) || a.index - b.index)
    .map(({ video }) => video);
}

/** Seznam vedle videa: nezhlédnutá napřed, zhlédnutá za nimi (jinak pořadí beze změny). */
export function unseenFirst<T extends { id: string }>(videos: readonly T[], seen: ReadonlySet<string>): T[] {
  const unseen: T[] = [];
  const watched: T[] = [];
  for (const v of videos) {
    if (!v) continue;
    (seen.has(v.id) ? watched : unseen).push(v);
  }
  return [...unseen, ...watched];
}

// ---- paměť prohlížeče (i bez přihlášení) ---------------------------------------------

export const SEEN_KEY = 'kine-seen-videos';
export const SEEN_MAX = 500;

/** Přidá video na začátek seznamu zhlédnutých (bez opakování, nejvýš SEEN_MAX). */
export function addSeen(list: readonly string[], id: string, max: number = SEEN_MAX): string[] {
  if (!id) return [...list];
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

function readSeen(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Zapamatuje si zhlédnuté video (components/WatchHistoryTracker.tsx). */
export function rememberSeen(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(addSeen(readSeen(), id)));
  } catch {
    // bez úložiště se pamatuje jen historie na účtu
  }
}

/** Videa zhlédnutá v tomhle prohlížeči. */
export function seenLocally(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  return new Set(readSeen());
}
