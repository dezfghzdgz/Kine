/**
 * Podporovatelé (playkine.com/supporters; v kódu "fans") - čistá logika bez databáze
 * (tests/fans.test.mjs).
 *
 * Kampaň na Instagramu: kdo začne Kine sledovat, toho přezdívka zůstane na
 * webu navždy. Jména přidává správce v Adminu (app/admin/supporters), stránka je
 * ukazuje podle dne kampaně ("Den 1", "Den 2"…). Ukládá se jen přezdívka
 * z Instagramu - žádné skutečné jméno ani fotka; kdo tam být nechce, toho
 * správce smaže.
 */

/** Přezdívka na Instagramu: 1-30 znaků, malá písmena, číslice, tečka a podtržítko. */
export const HANDLE_RE = /^[a-z0-9._]{1,30}$/;
/** Nejvíc jmen v jednom vložení (Admin) - víc najednou nikdo psát nebude. */
export const MAX_BULK = 200;

/**
 * Přezdívka z čehokoli, co správce vloží: "@jmeno", "jmeno", odkaz
 * https://www.instagram.com/jmeno/?igsh=… Instagram nerozlišuje velká a malá
 * písmena - ukládá se malými. null = tohle přezdívka být nemůže.
 */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)/i.exec(s);
  if (fromUrl) s = fromUrl[1];
  s = s.replace(/^@+/, '').trim().toLowerCase();
  if (!HANDLE_RE.test(s) || /^\.+$/.test(s)) return null;
  return s;
}

/**
 * Víc přezdívek naráz (řádky, čárky, středníky, mezery). Duplicity v tom, co
 * přišlo, se počítají jednou; pořadí zůstává.
 */
export function parseHandles(text: unknown): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  if (typeof text !== 'string') return { valid, invalid };
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const handle = normalizeHandle(part);
    if (!handle) {
      if (invalid.length < 50) invalid.push(part.slice(0, 60));
      continue;
    }
    if (seen.has(handle)) continue;
    seen.add(handle);
    valid.push(handle);
  }
  return { valid: valid.slice(0, MAX_BULK), invalid };
}

/** Kalendářní den (YYYY-MM-DD) v Praze - kampaň běží podle českých dnů, ne podle UTC. */
export function pragueDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * Kolikátý den kampaně je `nowMs`, když první jméno přibylo `firstMs`
 * (oboje podle pražského kalendáře). Bez prvního jména je to Den 1.
 */
export function campaignDay(firstMs: number | null, nowMs: number): number {
  if (firstMs === null || !Number.isFinite(firstMs)) return 1;
  const a = Date.parse(`${pragueDate(firstMs)}T00:00:00Z`);
  const b = Date.parse(`${pragueDate(nowMs)}T00:00:00Z`);
  const days = Math.round((b - a) / 86_400_000);
  return Math.max(1, days + 1);
}

/** Číslo dne od správce (volitelné): celé 1-100000, jinak null (= spočítá se samo). */
export function cleanDay(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : null;
}

export type FanEntry = {
  id: number;
  handle: string;
  day: number;
  createdAt: string;
  /** Propojený účet na Kine (odkaz na kanál a odznak Zakladatel); null = jen přezdívka. */
  kine: { id: string; username: string } | null;
};

export type FanDay = { day: number; entries: FanEntry[] };

/** Podle dne kampaně, nejnovější den nahoře; ve dni nejnovější jméno první. */
export function groupByDay(entries: readonly FanEntry[]): FanDay[] {
  const byDay = new Map<number, FanEntry[]>();
  for (const e of entries) {
    const list = byDay.get(e.day) ?? [];
    list.push(e);
    byDay.set(e.day, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, list]) => ({ day, entries: list.slice().sort((x, y) => (y.createdAt > x.createdAt ? 1 : y.createdAt < x.createdAt ? -1 : y.id - x.id)) }));
}

/**
 * Účet Kine na Instagramu z nastavení (odkaz nebo @jméno) jako adresa
 * profilu; null = nic / nesmysl (tlačítko se pak neukáže).
 */
export function instagramProfileUrl(raw: unknown): string | null {
  const handle = normalizeHandle(raw);
  return handle ? `https://www.instagram.com/${handle}/` : null;
}
