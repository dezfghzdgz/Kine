/**
 * Kolikrát divák na hlavní stránce viděl kartu videa a neklikl na ni.
 *
 * Bez toho feed ukazuje pořád stejná videa nahoře: skóre se mezi návštěvami
 * skoro nemění, takže kdo se na hlavní stránku vrací třikrát denně, vidí
 * třikrát totéž. Karta, kterou divák viděl (aspoň napůl na obrazovce přes
 * vteřinu) a nechtěl, postupně klesá (lib/homeRecommendation.ts -
 * impressionPenalty) a místo ní dostane šanci něco jiného.
 *
 * Žije jen v prohlížeči (localStorage) - nic se neposílá na server,
 * nevzniká žádná historie navíc. Záznamy po 14 dnech vyprší a jich je
 * nanejvýš pár stovek. Bez localStorage (anonymní okno, zákaz) se prostě
 * nic nepamatuje a feed funguje jako dřív.
 */

export const IMPRESSIONS_KEY = 'kine-feed-seen-v1';
export const IMPRESSIONS_MAX = 600;
export const IMPRESSIONS_TTL_MS = 14 * 24 * 3600 * 1000;
/** Stejnou kartu počítat nejvýš jednou za tuhle dobu (scroll nahoru a dolů není další zobrazení). */
export const IMPRESSION_GAP_MS = 20 * 60 * 1000;

/** id videa -> [počet zobrazení, kdy naposledy] */
export type ImpressionMap = Map<string, [number, number]>;

/** Z uloženého JSONu (cokoli, i rozbitého) - bez prošlých záznamů. */
export function parseImpressions(raw: string | null, now: number): ImpressionMap {
  const map: ImpressionMap = new Map();
  if (!raw) return map;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return map;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return map;
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(value) || typeof id !== 'string' || id.length > 64) continue;
    const count = Number(value[0]);
    const at = Number(value[1]);
    if (!Number.isFinite(count) || !Number.isFinite(at) || count < 1) continue;
    if (now - at > IMPRESSIONS_TTL_MS || at > now + 60_000) continue;
    map.set(id, [Math.min(99, Math.floor(count)), at]);
  }
  return map;
}

/** Nejstarší záznamy pryč, ať se do localStorage nehromadí. */
export function pruneImpressions(map: ImpressionMap, now: number, max = IMPRESSIONS_MAX): ImpressionMap {
  const fresh = [...map.entries()].filter(([, [, at]]) => now - at <= IMPRESSIONS_TTL_MS);
  fresh.sort((a, b) => b[1][1] - a[1][1]);
  return new Map(fresh.slice(0, max));
}

export function serializeImpressions(map: ImpressionMap): string {
  const out: Record<string, [number, number]> = {};
  for (const [id, entry] of map) out[id] = entry;
  return JSON.stringify(out);
}

/** Započítá zobrazení (stejná karta nejvýš jednou za IMPRESSION_GAP_MS). Vrací, jestli se něco změnilo. */
export function bumpImpressions(map: ImpressionMap, ids: string[], now: number): boolean {
  let changed = false;
  for (const id of ids) {
    if (!id) continue;
    const prev = map.get(id);
    if (prev && now - prev[1] < IMPRESSION_GAP_MS) continue;
    map.set(id, [Math.min(99, (prev?.[0] ?? 0) + 1), now]);
    changed = true;
  }
  return changed;
}

// --- Prohlížeč -------------------------------------------------------------

let cache: ImpressionMap | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function store(): ImpressionMap {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = typeof window !== 'undefined' ? window.localStorage.getItem(IMPRESSIONS_KEY) : null;
  } catch {
    raw = null;
  }
  cache = parseImpressions(raw, Date.now());
  return cache;
}

function scheduleSave() {
  if (typeof window === 'undefined' || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      cache = pruneImpressions(store(), Date.now());
      window.localStorage.setItem(IMPRESSIONS_KEY, serializeImpressions(cache));
    } catch {
      /* plné úložiště nebo zákaz - nevadí */
    }
  }, 1500);
}

/** Karty, které divák právě viděl. */
export function recordImpressions(ids: string[]): void {
  if (bumpImpressions(store(), ids, Date.now())) scheduleSave();
}

/** Divák na kartu klikl - o zájem tedy šlo, žádná penalizace. */
export function clearImpression(id: string): void {
  if (store().delete(id)) scheduleSave();
}

/**
 * Kolikrát divák kartu viděl - zmrazený stav pro jedno řazení (karty,
 * které se započítají během prohlížení, nepřeskupí to, co už je na stránce).
 */
export function impressionsSnapshot(): (videoId: string) => number {
  const frozen = new Map(store());
  return (videoId: string) => frozen.get(videoId)?.[0] ?? 0;
}
