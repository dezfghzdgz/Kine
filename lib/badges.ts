/**
 * Odznaky na kanálu: spočítají se z toho, co o kanálu víme (kdy se
 * registroval, videa, zhlédnutí, odběratelé, lajky, nejsledovanější video,
 * Sparks, vysílání, příspěvky, komentáře, spolupráce) - nic se kvůli nim
 * neukládá. Každá řada má víc stupňů (bronz, stříbro, zlato, platina,
 * diamant, mistr, legenda, mýtus); u řady se ukáže jen nejvyšší dosažený
 * stupeň. Majitel kanálu navíc vidí, který odznak má nejblíž
 * (components/ChannelBadges.tsx). Čísla počítá server
 * (lib/badgeCheck.ts - badgeStatsFor, /api/badges/stats).
 *
 * Čistá logika - má test (tests/badges.test.mjs).
 */

export type BadgeId =
  | 'early'
  | 'years'
  | 'videos'
  | 'views'
  | 'subscribers'
  | 'sparks'
  | 'streamer'
  | 'likes'
  | 'hit'
  | 'streamHours'
  | 'posts'
  | 'comments'
  | 'collabs';

export type BadgeStats = {
  /** Kdy vznikl účet (ISO). */
  joinedAt: string | null;
  /** Zveřejněná videa (vlastní, ne spolupráce). */
  videos: number;
  /** Součet zhlédnutí těch videí. */
  views: number;
  subscribers: number;
  /** Z toho Sparks (krátká videa na výšku). */
  sparks: number;
  /** Kanál vysílal živě (má záznam vysílání). */
  streamed: boolean;
  /** Lajky u vlastních zveřejněných videí. */
  likes?: number;
  /** Zhlédnutí nejsledovanějšího videa (řada Hit). */
  topVideoViews?: number;
  /** Hodiny živého vysílání. */
  streamHours?: number;
  /** Příspěvky (text, fotky, ankety). */
  posts?: number;
  /** Napsané komentáře (u videí a příspěvků). */
  comments?: number;
  /** Přijaté spolupráce na cizích videích. */
  collabs?: number;
};

export type Badge = { id: BadgeId; /** Stupeň v řadě (0 = první). */ level: number; /** Číslo do textu: hranice stupně (10 videí, 1000 zhlédnutí, 2 roky). */ value: number };

export type NextBadge = { id: Exclude<BadgeId, 'early' | 'streamer' | 'years'>; target: number; current: number; missing: number };

/** Registrace do konce roku 2026 = průkopník (Kine na začátku). */
export const EARLY_MEMBER_BEFORE = Date.parse('2027-01-01T00:00:00Z');

export const BADGE_TIERS = {
  years: [1, 2, 3, 5, 10],
  videos: [1, 10, 25, 50, 100, 250, 500, 1_000],
  views: [100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000],
  subscribers: [10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000],
  likes: [10, 100, 1_000, 10_000, 100_000, 1_000_000],
  hit: [1_000, 10_000, 100_000, 1_000_000, 10_000_000],
  sparks: [1, 10, 50, 100, 250, 500],
  streamHours: [1, 10, 50, 100, 500, 1_000],
  posts: [1, 10, 50, 100, 500],
  comments: [10, 100, 500, 1_000, 5_000],
  collabs: [1, 5, 10, 25, 50],
} as const;

/** Názvy stupňů (barvy): bronz, stříbro, zlato, platina, diamant, mistr, legenda, mýtus. */
export const TIER_COUNT = 8;

type Tiered = keyof typeof BADGE_TIERS;

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Pořadí na kanálu: nejdřív to, co o tvůrci říká nejvíc. */
const ORDER: BadgeId[] = ['subscribers', 'views', 'hit', 'likes', 'videos', 'sparks', 'streamHours', 'streamer', 'posts', 'comments', 'collabs', 'years', 'early'];

/**
 * Pořadí pro odznaky na kanálu, dokud tvůrce sám nic nevybral: původní řady
 * v původním pořadí, nové až za nimi. Kanálům se tak nové řady nepřehodily
 * (a "Hit" se neukazuje hned vedle skoro stejného "N+ zhlédnutí").
 */
const DEFAULT_SHOWCASE_ORDER: BadgeId[] = ['subscribers', 'views', 'videos', 'sparks', 'streamer', 'years', 'early', 'likes', 'streamHours', 'posts', 'comments', 'collabs', 'hit'];

/** Řady, které se u "dalšího odznaku" nabízejí až když v nich tvůrce něco má (jinak by "0 z 1" strašilo každého). */
const OPTIONAL_SERIES: readonly Tiered[] = ['sparks', 'streamHours', 'posts', 'comments', 'collabs', 'hit'];

function safe(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Celé roky od registrace. */
export function yearsOnKine(joinedAt: string | null, now = Date.now()): number {
  const t = joinedAt ? Date.parse(joinedAt) : NaN;
  if (!Number.isFinite(t) || t > now) return 0;
  return Math.floor((now - t) / YEAR_MS);
}

function current(stats: BadgeStats, kind: Tiered, now: number): number {
  switch (kind) {
    case 'years':
      return yearsOnKine(stats.joinedAt, now);
    case 'hit':
      return safe(stats.topVideoViews ?? 0);
    default:
      return safe(stats[kind] ?? 0);
  }
}

/** Získané odznaky (od každé řady jen nejvyšší stupeň), seřazené pro kanál. */
export function computeBadges(stats: BadgeStats, now = Date.now()): Badge[] {
  const out: Badge[] = [];
  for (const kind of Object.keys(BADGE_TIERS) as Tiered[]) {
    const tiers = BADGE_TIERS[kind];
    const value = current(stats, kind, now);
    let level = -1;
    for (let i = 0; i < tiers.length; i++) if (value >= tiers[i]) level = i;
    if (level >= 0) out.push({ id: kind, level, value: tiers[level] });
  }
  if (stats.streamed) out.push({ id: 'streamer', level: 0, value: 1 });
  const joined = stats.joinedAt ? Date.parse(stats.joinedAt) : NaN;
  if (Number.isFinite(joined) && joined < EARLY_MEMBER_BEFORE) out.push({ id: 'early', level: 0, value: 1 });
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

/**
 * Nejbližší další odznak (nejvíc splněný v poměru) - motivace pro majitele
 * kanálu. Roky se nepočítají (na ty se nedá pracovat); null = všechno má.
 */
export function nextBadge(stats: BadgeStats, now = Date.now()): NextBadge | null {
  let best: NextBadge | null = null;
  let bestRatio = -1;
  for (const kind of Object.keys(BADGE_TIERS) as Tiered[]) {
    if (kind === 'years') continue;
    const tiers = BADGE_TIERS[kind];
    const value = current(stats, kind, now);
    const target = tiers.find((t) => value < t);
    if (target === undefined) continue;
    // Volitelné řady až když v nich něco má (jinak by "0 z 10 Sparks" strašilo i tvůrce dlouhých videí).
    if (OPTIONAL_SERIES.includes(kind) && value === 0) continue;
    const ratio = value / target;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { id: kind as NextBadge['id'], target, current: value, missing: target - value };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Výběr na kanál (jako v Clash Royale), sbírka a oznámení o novém odznaku.
// ---------------------------------------------------------------------------

/** Na kanálu jsou vidět nejvýš tři odznaky - které, si vybere majitel. */
export const SHOWCASE_MAX = 3;

/** Všechny řady odznaků v pořadí sbírky. */
export const BADGE_IDS: readonly BadgeId[] = ORDER;

export function isBadgeId(value: unknown): value is BadgeId {
  return typeof value === 'string' && (ORDER as string[]).includes(value);
}

/** Klíč pro "o tomhle už ví" (profiles.badges_seen): řada + stupeň - videos:10, views:1000. */
export function badgeKey(b: Badge): string {
  return `${b.id}:${b.value}`;
}

/** Získané odznaky, o kterých tvůrce ještě neví (nejsou mezi `seen`). */
export function unseenBadges(earned: readonly Badge[], seen: readonly string[]): Badge[] {
  const known = new Set(seen);
  return earned.filter((b) => !known.has(badgeKey(b)));
}

/** Co si zapamatovat po kontrole: staré + všechno, co má teď (o ztraceném a znovu získaném stupni se znovu nehlásí). */
export function mergeSeen(seen: readonly string[], earned: readonly Badge[]): string[] {
  return Array.from(new Set([...seen.filter((k) => typeof k === 'string'), ...earned.map(badgeKey)])).slice(-200);
}

/** Výběr z databáze / od uživatele: jen platné řady, bez opakování, nejvýš tři. null = ještě nevybíral. */
export function sanitizeShowcase(value: unknown): BadgeId[] | null {
  if (!Array.isArray(value)) return null;
  const out: BadgeId[] = [];
  for (const id of value) {
    if (isBadgeId(id) && !out.includes(id)) out.push(id);
    if (out.length >= SHOWCASE_MAX) break;
  }
  return out;
}

/**
 * Odznaky na kanálu: vybrané (v pořadí výběru; jen ty, které pořád má),
 * a dokud nic nevybral, první tři podle DEFAULT_SHOWCASE_ORDER. Prázdný výběr = schválně žádný.
 */
export function showcaseBadges(earned: readonly Badge[], showcase: unknown, max = SHOWCASE_MAX): Badge[] {
  const picked = sanitizeShowcase(showcase);
  if (picked === null) return [...earned].sort((a, b) => DEFAULT_SHOWCASE_ORDER.indexOf(a.id) - DEFAULT_SHOWCASE_ORDER.indexOf(b.id)).slice(0, max);
  const out: Badge[] = [];
  for (const id of picked) {
    const badge = earned.find((b) => b.id === id);
    if (badge) out.push(badge);
    if (out.length >= max) break;
  }
  return out;
}

/** Řada ve sbírce: dosažený stupeň (nebo null), kolik stupňů řada má a jak daleko je další. */
export type BadgeProgress = {
  id: BadgeId;
  badge: Badge | null;
  /** Počet stupňů řady (Průkopník a Streamer mají jeden). */
  tiers: number;
  /** Hranice dalšího stupně - null = má nejvyšší (nebo řada stupně nemá). */
  next: number | null;
  current: number;
};

export function badgeProgress(stats: BadgeStats, now = Date.now()): BadgeProgress[] {
  const earned = computeBadges(stats, now);
  return ORDER.map((id) => {
    const badge = earned.find((b) => b.id === id) ?? null;
    if (id === 'early' || id === 'streamer') return { id, badge, tiers: 1, next: null, current: badge ? 1 : 0 };
    const tiers = BADGE_TIERS[id];
    const value = current(stats, id, now);
    const next = tiers.find((t) => value < t) ?? null;
    return { id, badge, tiers: tiers.length, next, current: value };
  });
}
