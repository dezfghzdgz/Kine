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

/**
 * Speciální odznaky - nepočítají se, přiděluje je tým Kine (/admin/badges,
 * tabulka profile_special_badges): Majitel, Vývojář, Tým Kine, Moderátor,
 * Beta tester, Partner, Lovec chyb. Na kanálu jsou první (dokud si majitel
 * kanálu nevybere jinak - i "žádný").
 */
export const SPECIAL_BADGES = ['owner', 'dev', 'team', 'moderator', 'betaTester', 'partner', 'bugHunter'] as const;
export type SpecialBadgeId = (typeof SPECIAL_BADGES)[number];

export function isSpecialBadge(value: unknown): value is SpecialBadgeId {
  return typeof value === 'string' && (SPECIAL_BADGES as readonly string[]).includes(value);
}

/** Speciální odznaky z databáze: jen známé, bez opakování, v pevném pořadí. */
export function sanitizeSpecial(value: unknown): SpecialBadgeId[] {
  if (!Array.isArray(value)) return [];
  return SPECIAL_BADGES.filter((id) => value.includes(id));
}

/**
 * Vlastní odznak od týmu Kine: moderátor nebo správce si ho vytvoří na
 * /admin/badges (název, ikona, barva, případně vlastní obrázek nebo GIF)
 * a přidělí komu chce - tabulky custom_badges a profile_custom_badges
 * (supabase-migration-odznaky-vlastni.sql). Na kanálu a ve výběru je jako
 * "custom:<id>".
 */
export type CustomBadgeDef = { id: string; name: string; description: string | null; icon: string; color: string; image: string | null };
export type CustomBadgeId = `custom:${string}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOM_ID_RE = /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ikony, ze kterých jde vlastní odznak složit (components/UiIcon.tsx). */
export const CUSTOM_BADGE_ICONS = [
  'starFilled', 'star', 'sparkle', 'trophy', 'heart', 'bolt', 'shield', 'bug', 'keyboard', 'users',
  'broadcast', 'film', 'eye', 'thumbUp', 'chat', 'link', 'pencil', 'timer', 'record', 'flag',
  'gamepad', 'camera', 'headphones', 'smile', 'leaf', 'moon', 'sun', 'globe',
] as const;
export const CUSTOM_BADGE_COLORS = ['#f5c542', '#a855f7', '#3b82f6', '#22c55e', '#ef4444', '#f97316', '#ec4899', '#14b8a6', '#64748b'] as const;
export const CUSTOM_BADGE_NAME_MAX = 32;
export const CUSTOM_BADGE_DESC_MAX = 160;

export function isCustomBadgeId(value: unknown): value is CustomBadgeId {
  return typeof value === 'string' && CUSTOM_ID_RE.test(value);
}

export function customBadgeId(uuid: string): CustomBadgeId {
  return `custom:${uuid.toLowerCase()}`;
}

/** Vlastní odznaky z databáze / od serveru: jen platné, bez opakování (nejvýš 50). */
export function sanitizeCustom(value: unknown): CustomBadgeDef[] {
  if (!Array.isArray(value)) return [];
  const out: CustomBadgeDef[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' && UUID_RE.test(r.id) ? r.id.toLowerCase() : null;
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_BADGE_NAME_MAX) : '';
    if (!id || !name || out.some((d) => d.id === id)) continue;
    const icon = typeof r.icon === 'string' && (CUSTOM_BADGE_ICONS as readonly string[]).includes(r.icon) ? r.icon : 'starFilled';
    const color = typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color.toLowerCase() : CUSTOM_BADGE_COLORS[1];
    const image = typeof r.image === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(r.image) ? r.image : null;
    const description = typeof r.description === 'string' && r.description.trim() ? r.description.replace(/\s+/g, ' ').trim().slice(0, CUSTOM_BADGE_DESC_MAX) : null;
    out.push({ id, name, description, icon, color, image });
    if (out.length >= 50) break;
  }
  return out;
}

export type BadgeId =
  | SpecialBadgeId
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
  /** Speciální odznaky od týmu Kine (Majitel, Beta tester...). */
  special?: readonly string[];
  /** Vlastní odznaky od týmu Kine (název, ikona, barva, obrázek). */
  custom?: readonly CustomBadgeDef[];
};

/** Řada odznaků (počítaná, speciální) nebo vlastní odznak ("custom:<id>"). */
export type AnyBadgeId = BadgeId | CustomBadgeId;

export type Badge = {
  id: AnyBadgeId;
  /** Stupeň v řadě (0 = první). */
  level: number;
  /** Číslo do textu: hranice stupně (10 videí, 1000 zhlédnutí, 2 roky). */
  value: number;
  /** Vlastní odznak: jak vypadá (název, ikona, barva, obrázek). */
  custom?: CustomBadgeDef;
};

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

/** Pořadí na kanálu: nejdřív speciální (od týmu Kine), pak to, co o tvůrci říká nejvíc. */
const ORDER: BadgeId[] = [...SPECIAL_BADGES, 'subscribers', 'views', 'hit', 'likes', 'videos', 'sparks', 'streamHours', 'streamer', 'posts', 'comments', 'collabs', 'years', 'early'];

/**
 * Pořadí pro odznaky na kanálu, dokud tvůrce sám nic nevybral: původní řady
 * v původním pořadí, nové až za nimi. Kanálům se tak nové řady nepřehodily
 * (a "Hit" se neukazuje hned vedle skoro stejného "N+ zhlédnutí").
 */
const DEFAULT_SHOWCASE_ORDER: BadgeId[] = [...SPECIAL_BADGES, 'subscribers', 'views', 'videos', 'sparks', 'streamer', 'years', 'early', 'likes', 'streamHours', 'posts', 'comments', 'collabs', 'hit'];

/** Řady, které se u "dalšího odznaku" nabízejí až když v nich tvůrce něco má (jinak by "0 z 1" strašilo každého). */
const OPTIONAL_SERIES: readonly Tiered[] = ['sparks', 'streamHours', 'posts', 'comments', 'collabs', 'hit'];

/** Pořadí odznaku v seznamu: vlastní hned za speciálními (od týmu Kine), před počítanými řadami. */
function rank(id: AnyBadgeId, list: readonly BadgeId[]): number {
  if (isCustomBadgeId(id)) return SPECIAL_BADGES.length - 0.5;
  const i = list.indexOf(id);
  return i < 0 ? list.length : i;
}

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
  for (const id of sanitizeSpecial(stats.special)) out.push({ id, level: 0, value: 1 });
  for (const def of sanitizeCustom(stats.custom)) out.push({ id: customBadgeId(def.id), level: 0, value: 1, custom: def });
  const joined = stats.joinedAt ? Date.parse(stats.joinedAt) : NaN;
  if (Number.isFinite(joined) && joined < EARLY_MEMBER_BEFORE) out.push({ id: 'early', level: 0, value: 1 });
  // Stabilní řazení: vlastní odznaky mezi sebou v pořadí, v jakém je server poslal.
  return out.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b.id, ORDER) - rank(y.b.id, ORDER) || x.i - y.i).map((x) => x.b);
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

export function isBadgeId(value: unknown): value is AnyBadgeId {
  return typeof value === 'string' && ((ORDER as string[]).includes(value) || isCustomBadgeId(value));
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
export function sanitizeShowcase(value: unknown): AnyBadgeId[] | null {
  if (!Array.isArray(value)) return null;
  const out: AnyBadgeId[] = [];
  for (const raw of value) {
    const id = typeof raw === 'string' && isCustomBadgeId(raw) ? (raw.toLowerCase() as AnyBadgeId) : raw;
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
  if (picked === null) {
    return earned
      .map((b, i) => ({ b, i }))
      .sort((x, y) => rank(x.b.id, DEFAULT_SHOWCASE_ORDER) - rank(y.b.id, DEFAULT_SHOWCASE_ORDER) || x.i - y.i)
      .map((x) => x.b)
      .slice(0, max);
  }
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
  id: AnyBadgeId;
  badge: Badge | null;
  /** Počet stupňů řady (Průkopník a Streamer mají jeden). */
  tiers: number;
  /** Hranice dalšího stupně - null = má nejvyšší (nebo řada stupně nemá). */
  next: number | null;
  current: number;
};

export function badgeProgress(stats: BadgeStats, now = Date.now()): BadgeProgress[] {
  const earned = computeBadges(stats, now);
  // Speciální a vlastní odznaky jsou ve sbírce jen u toho, kdo je má (zamčené by nikoho nemotivovaly).
  const rows: BadgeProgress[] = ORDER.filter((id) => !isSpecialBadge(id) || earned.some((b) => b.id === id)).map((id) => {
    const badge = earned.find((b) => b.id === id) ?? null;
    if (id === 'early' || id === 'streamer' || isSpecialBadge(id)) return { id, badge, tiers: 1, next: null, current: badge ? 1 : 0 };
    const tiers = BADGE_TIERS[id];
    const value = current(stats, id, now);
    const next = tiers.find((t) => value < t) ?? null;
    return { id, badge, tiers: tiers.length, next, current: value };
  });
  const custom: BadgeProgress[] = earned.filter((b) => isCustomBadgeId(b.id)).map((b) => ({ id: b.id, badge: b, tiers: 1, next: null, current: 1 }));
  const afterSpecial = rows.findIndex((r) => !isSpecialBadge(r.id));
  rows.splice(afterSpecial < 0 ? rows.length : afterSpecial, 0, ...custom);
  return rows;
}

/** Jen získané odznaky (sbírka u cizího kanálu - zamčené řady patří jen majiteli). */
export function earnedProgress(stats: BadgeStats, now = Date.now()): BadgeProgress[] {
  return badgeProgress(stats, now).filter((p) => p.badge !== null);
}

// ---------------------------------------------------------------------------
// Vlastní odznaky - kontrola toho, co pošle tým Kine (/admin/badges).
// ---------------------------------------------------------------------------

/** Nejvýš tak velký obrázek vlastního odznaku (PNG, JPG, GIF, WebP). */
export const CUSTOM_BADGE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Druh obrázku podle prvních bajtů (ne podle přípony); null = není to PNG/JPG/GIF/WebP. */
export function badgeImageKind(bytes: Uint8Array): { ext: 'png' | 'jpg' | 'gif' | 'webp'; type: string } | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', type: 'image/gif' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

export type CustomBadgeInput = { name: string; description: string | null; icon: string; color: string; image: string | null };

/**
 * Nový / upravený vlastní odznak z formuláře: ořezaný název (povinný), popis,
 * ikona z nabídky, barva #rrggbb, obrázek jen z úložiště Kine (adresa, kterou
 * vrátilo nahrání). `partial` = úprava - chybějící pole se nemění.
 */
export function customBadgeInput(
  raw: unknown,
  opts: { partial?: boolean; imageBase?: string | null } = {}
): { ok: true; value: Partial<CustomBadgeInput> } | { ok: false; error: string } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Partial<CustomBadgeInput> = {};
  if (r.name !== undefined || !opts.partial) {
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim() : '';
    if (!name) return { ok: false, error: 'Odznak potřebuje název.' };
    if (name.length > CUSTOM_BADGE_NAME_MAX) return { ok: false, error: `Název může mít nejvýš ${CUSTOM_BADGE_NAME_MAX} znaků.` };
    out.name = name;
  }
  if (r.description !== undefined || !opts.partial) {
    const d = typeof r.description === 'string' ? r.description.replace(/\s+/g, ' ').trim() : '';
    if (d.length > CUSTOM_BADGE_DESC_MAX) return { ok: false, error: `Popis může mít nejvýš ${CUSTOM_BADGE_DESC_MAX} znaků.` };
    out.description = d || null;
  }
  if (r.icon !== undefined || !opts.partial) {
    const icon = typeof r.icon === 'string' ? r.icon : 'starFilled';
    if (!(CUSTOM_BADGE_ICONS as readonly string[]).includes(icon)) return { ok: false, error: 'Neznámá ikona.' };
    out.icon = icon;
  }
  if (r.color !== undefined || !opts.partial) {
    const color = typeof r.color === 'string' ? r.color.trim().toLowerCase() : CUSTOM_BADGE_COLORS[1];
    if (!/^#[0-9a-f]{6}$/.test(color)) return { ok: false, error: 'Barva musí být ve tvaru #rrggbb.' };
    out.color = color;
  }
  if (r.image !== undefined || !opts.partial) {
    const image = typeof r.image === 'string' && r.image.trim() ? r.image.trim() : null;
    // Jen obrázek nahraný přes Kine (žádné cizí adresy - ty by mohly sledovat diváky).
    if (image && (!opts.imageBase || !image.startsWith(opts.imageBase) || !/^https:\/\/[^\s"'<>]+$/.test(image))) {
      return { ok: false, error: 'Obrázek musí být nahraný přes Kine.' };
    }
    out.image = image;
  }
  return { ok: true, value: out };
}
