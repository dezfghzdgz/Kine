/**
 * Co nabídnout po konci videa (a v pořadí vedle videa): pořád něco nového.
 *
 * Dřív se po konci nabízela prostě nejnovější videa na Kine - klidně ta,
 * která divák už viděl. Teď:
 *  - po konci videa (odpočet, automatické pokračování) jen videa, která
 *    divák ještě neviděl - podle historie na účtu (watch_history) i podle
 *    paměti prohlížeče (funguje i bez přihlášení);
 *  - v pořadí podle podobnosti (rankRelated - společné hashtagy, kategorie,
 *    tvůrce); dřív se to po konci přeřadilo hrubě jen podle kategorie
 *    a tvůrce a shoda v hashtazích se ztratila;
 *  - nikdy video, které ještě nejde pustit (premiéra s odpočtem, naplánované) -
 *    automatické pokračování dřív skončilo na odpočtu premiéry;
 *  - v seznamu vedle videa podobná napřed (rankRelated), zhlédnutá až za
 *    nezhlédnutými, jeden kanál nezaplní celý seznam.
 * Když nových videí není dost, doplní se ta, která divák viděl nejdávněji
 * (označená „Zhlédnuto“) - nabídka po konci tak nikdy nezůstane prázdná
 * (dřív se pak neukázalo nic a vypadalo to jako chyba).
 * Fronta a další video z playlistu mají přednost dál - ty si vybral sám.
 *
 * Čisté funkce (bez prohlížeče) mají test: tests/upNext.test.mjs.
 */

export type UpNextCandidate = {
  id: string;
  owner_id?: string | null;
  category?: string | null;
  scheduled_at?: string | null;
  is_premiere?: boolean | null;
};

/** Čas zveřejnění je v budoucnu (premiéra s odpočtem, naplánované video) - pustit to ještě nejde. */
export function notPlayableYet(video: { scheduled_at?: string | null } | null | undefined, now: number = Date.now()): boolean {
  if (!video?.scheduled_at) return false;
  const at = Date.parse(video.scheduled_at);
  return Number.isFinite(at) && at > now;
}

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

/**
 * Po konci videa. `candidates` jsou už seřazené podle podobnosti (rankRelated)
 * a to pořadí se drží: nezhlédnutá napřed, a když jich je méně než `want`,
 * doplní se zhlédnutá - nejdéle neviděná napřed. `seenOrder` = id zhlédnutých
 * od nejnovějšího (historie na účtu, pak paměť prohlížeče). Video, které ještě
 * nejde pustit (premiéra s odpočtem, naplánované), se nenabídne vůbec.
 */
export function upNextWithFallback<T extends UpNextCandidate>(
  candidates: readonly T[],
  current: CurrentVideo,
  seenOrder: readonly string[],
  want = 2,
  now: number = Date.now()
): T[] {
  const seen = new Set(seenOrder);
  const unique = new Set<string>();
  const playable = candidates
    .map((video, index) => ({ video, index }))
    .filter(({ video }) => {
      if (!video?.id || video.id === current.id || unique.has(video.id) || notPlayableYet(video, now)) return false;
      unique.add(video.id);
      return true;
    });
  const fresh = playable.filter(({ video }) => !seen.has(video.id)).map(({ video }) => video);
  if (fresh.length >= want) return fresh;
  const recency = new Map<string, number>();
  seenOrder.forEach((id, i) => {
    if (!recency.has(id)) recency.set(id, i);
  });
  const older = playable
    .filter(({ video }) => seen.has(video.id))
    // Větší pořadí v seznamu zhlédnutých = viděné dávněji -> dřív.
    .sort((a, b) => (recency.get(b.video.id) ?? -1) - (recency.get(a.video.id) ?? -1) || a.index - b.index)
    .map(({ video }) => video);
  return [...fresh, ...older];
}

export type RelatedCandidate = UpNextCandidate & {
  hashtags?: string[] | null;
  views?: number | null;
  created_at?: string | null;
};

/** O kolik bodů přijde každé další video stejného kanálu v seznamu (lehká rozmanitost). */
export const RELATED_SAME_OWNER_HIT = 7;

/**
 * Seznam vedle videa: podobná napřed. Dřív tu byla prostě nejnovější videa
 * na Kine (jen nezhlédnutá napřed) - k videu o Minecraftu klidně recept.
 * Teď: společné hashtagy, stejná kategorie a stejný tvůrce, k tomu trochu
 * oblíbenost a čerstvost. Zhlédnutá až za nezhlédnutými; bez opakování.
 * Každé další video téhož kanálu ztrácí pár bodů (RELATED_SAME_OWNER_HIT) -
 * "víc od tohoto tvůrce" zůstane nahoře, ale celý seznam nezaplní.
 */
export function rankRelated<T extends RelatedCandidate>(
  candidates: readonly T[],
  current: CurrentVideo & { hashtags?: string[] | null },
  seen: ReadonlySet<string>,
  now: number = Date.now()
): T[] {
  const tags = new Set((Array.isArray(current.hashtags) ? current.hashtags : []).filter((h) => typeof h === 'string').map((h) => h.toLowerCase()));
  const score = (v: T) => {
    const shared = (Array.isArray(v.hashtags) ? v.hashtags : []).filter((h) => typeof h === 'string' && tags.has(h.toLowerCase())).length;
    const related =
      Math.min(3, shared) * 12 +
      (current.category && v.category === current.category ? 10 : 0) +
      (current.owner_id && v.owner_id === current.owner_id ? 8 : 0);
    const popularity = Math.log10(Math.max(0, Number(v.views) || 0) + 1) * 3;
    const ageDays = v.created_at ? (now - Date.parse(v.created_at)) / 86400000 : NaN;
    const freshness = Number.isFinite(ageDays) && ageDays >= 0 ? Math.exp(-ageDays / 30) * 6 : 0;
    return related + popularity + freshness;
  };
  const unique = new Map<string, { video: T; index: number; s: number; seen: boolean }>();
  candidates.forEach((video, index) => {
    if (!video?.id || video.id === current.id || unique.has(video.id)) return;
    unique.set(video.id, { video, index, s: score(video), seen: seen.has(video.id) });
  });
  const sorted = [...unique.values()].sort((a, b) => Number(a.seen) - Number(b.seen) || b.s - a.s || a.index - b.index);
  // Lehká rozmanitost: hladový výběr, každé další video téhož kanálu o kus níž
  // (zvlášť v nezhlédnutých a zvlášť ve zhlédnutých - ty zůstávají až za nimi).
  const out: T[] = [];
  for (const group of [sorted.filter((x) => !x.seen), sorted.filter((x) => x.seen)]) {
    const owners = new Map<string, number>();
    const pool = [...group];
    while (pool.length > 0) {
      let best = 0;
      let bestValue = -Infinity;
      for (let i = 0; i < pool.length; i++) {
        const owner = pool[i].video.owner_id;
        const value = pool[i].s - (owner ? owners.get(owner) ?? 0 : 0) * RELATED_SAME_OWNER_HIT;
        if (value > bestValue) {
          bestValue = value;
          best = i;
        }
      }
      const [pick] = pool.splice(best, 1);
      out.push(pick.video);
      const owner = pick.video.owner_id;
      if (owner) owners.set(owner, (owners.get(owner) ?? 0) + 1);
    }
  }
  return out;
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

/** Zhlédnutá videa v prohlížeči od nejnovějšího (pro doplnění nabídky po konci). */
export function seenOrderLocally(): string[] {
  if (typeof window === 'undefined') return [];
  return readSeen();
}
