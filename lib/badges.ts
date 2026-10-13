/**
 * Odznaky na kanálu (první verze): spočítají se z toho, co o kanálu víme
 * (kdy se registroval, kolik má videí, zhlédnutí, odběratelů, Sparks, jestli
 * vysílal živě) - nic se kvůli nim neukládá. U každé řady se ukáže jen
 * nejvyšší dosažený stupeň; majitel kanálu navíc vidí, který odznak má
 * nejblíž (components/ChannelBadges.tsx).
 *
 * Čistá logika - má test (tests/badges.test.mjs).
 */

export type BadgeId = 'early' | 'years' | 'videos' | 'views' | 'subscribers' | 'sparks' | 'streamer';

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
};

export type Badge = { id: BadgeId; /** Stupeň v řadě (0 = první). */ level: number; /** Číslo do textu: hranice stupně (10 videí, 1000 zhlédnutí, 2 roky). */ value: number };

export type NextBadge = { id: Exclude<BadgeId, 'early' | 'streamer'>; target: number; current: number; missing: number };

/** Registrace do konce roku 2026 = průkopník (Kine na začátku). */
export const EARLY_MEMBER_BEFORE = Date.parse('2027-01-01T00:00:00Z');

export const BADGE_TIERS = {
  years: [1, 2, 3, 5, 10],
  videos: [1, 10, 50, 100, 500],
  views: [1_000, 10_000, 100_000, 1_000_000, 10_000_000],
  subscribers: [100, 1_000, 10_000, 100_000, 1_000_000],
  sparks: [10, 50, 100, 500],
} as const;

type Tiered = keyof typeof BADGE_TIERS;

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** Pořadí na kanálu: nejdřív to, co o tvůrci říká nejvíc. */
const ORDER: BadgeId[] = ['subscribers', 'views', 'videos', 'sparks', 'streamer', 'years', 'early'];

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
  if (kind === 'years') return yearsOnKine(stats.joinedAt, now);
  return safe(stats[kind]);
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
  for (const kind of ['videos', 'views', 'subscribers', 'sparks'] as const) {
    const tiers = BADGE_TIERS[kind];
    const value = current(stats, kind, now);
    const target = tiers.find((t) => value < t);
    if (target === undefined) continue;
    // Sparks až když nějaké má (jinak by "0 z 10 Sparks" strašilo i tvůrce dlouhých videí).
    if (kind === 'sparks' && value === 0) continue;
    const ratio = value / target;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { id: kind, target, current: value, missing: target - value };
    }
  }
  return best;
}
