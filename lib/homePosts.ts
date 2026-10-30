/**
 * Řada „Novinky od tvých kanálů“ na hlavní stránce (components/HomePostsShelf.tsx).
 *
 * Příspěvky na YouTube na hlavní stránce ruší, protože se míchají mezi
 * videa a nejdou vypnout. Tady naopak:
 *  - jen přihlášený a jen příspěvky kanálů, které odebírá (žádné cizí),
 *  - jen posledních 7 dní a jen ty, které ještě neotevřel,
 *  - nejvýš 2 od jednoho kanálu (jeden upovídaný kanál řadu nezahltí),
 *  - jedna nízká řada pod prvním blokem videí, nikdy mezi videi,
 *  - „Skrýt“ ji schová na týden, v Nastavení -> Hlavní stránka jde vypnout úplně,
 *  - když není nic nového, není vidět vůbec (ani nadpis).
 *
 * Co se ukáže, rozhoduje pickShelfPosts (test tests/homePosts.test.mjs).
 */

export const HOME_POSTS_KEY = 'kine-home-posts';
export const HOME_POSTS_SNOOZE_KEY = 'kine-home-posts-snooze';
export const HOME_POSTS_SEEN_KEY = 'kine-home-posts-seen';
export const SHELF_MAX_AGE_DAYS = 7;
export const SHELF_MAX_POSTS = 12;
export const SHELF_PER_CHANNEL = 2;
export const SHELF_SNOOZE_DAYS = 7;
const SEEN_KEEP = 300;

export type ShelfPost = {
  id: string;
  owner_id: string;
  created_at: string;
  [key: string]: unknown;
};

/** Které příspěvky do řady: nové (7 dní), neotevřené, ne vlastní, max 2 na kanál, nejnovější první. */
export function pickShelfPosts<T extends ShelfPost>(
  posts: readonly T[],
  opts: { seen: ReadonlySet<string>; viewerId: string | null; now?: number; max?: number; perChannel?: number }
): T[] {
  const now = opts.now ?? Date.now();
  const since = now - SHELF_MAX_AGE_DAYS * 24 * 3600 * 1000;
  const max = opts.max ?? SHELF_MAX_POSTS;
  const perChannel = opts.perChannel ?? SHELF_PER_CHANNEL;
  const perOwner = new Map<string, number>();
  const out: T[] = [];
  const sorted = [...posts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const p of sorted) {
    if (out.length >= max) break;
    const at = Date.parse(p.created_at);
    if (!Number.isFinite(at) || at < since || at > now + 5 * 60 * 1000) continue;
    if (opts.seen.has(p.id)) continue;
    if (opts.viewerId && p.owner_id === opts.viewerId) continue;
    const n = perOwner.get(p.owner_id) ?? 0;
    if (n >= perChannel) continue;
    perOwner.set(p.owner_id, n + 1);
    out.push(p);
  }
  return out;
}

/** Krátký úryvek textu příspěvku pro kartičku (bez zalomení, nejvýš `max` znaků). */
export function postExcerpt(content: unknown, max = 140): string {
  const text = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Prohlížeč bez úložiště (anonymní okno) - nastavení platí jen do zavření stránky.
  }
}

/** Řada zapnutá v Nastavení (výchozí ano). */
export function homePostsEnabled(): boolean {
  return read(HOME_POSTS_KEY) !== 'off';
}
export function setHomePostsEnabled(on: boolean) {
  write(HOME_POSTS_KEY, on ? null : 'off');
  if (on) write(HOME_POSTS_SNOOZE_KEY, null);
}

/** Schovaná tlačítkem „Skrýt“ (na týden)? */
export function homePostsSnoozed(now: number = Date.now()): boolean {
  const until = Number(read(HOME_POSTS_SNOOZE_KEY));
  return Number.isFinite(until) && until > now;
}
export function snoozeHomePosts(now: number = Date.now()) {
  write(HOME_POSTS_SNOOZE_KEY, String(now + SHELF_SNOOZE_DAYS * 24 * 3600 * 1000));
}

/** Otevřené příspěvky (v řadě se už neukážou). */
export function seenPostIds(): Set<string> {
  try {
    const list = JSON.parse(read(HOME_POSTS_SEEN_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
export function markPostSeen(id: string) {
  if (!id) return;
  const list = [...seenPostIds()].filter((x) => x !== id);
  list.push(id);
  write(HOME_POSTS_SEEN_KEY, JSON.stringify(list.slice(-SEEN_KEEP)));
}
