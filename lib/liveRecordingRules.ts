/**
 * Záznam vysílání -> video: čistá logika bez databáze (tests/liveRecording.test.mjs).
 * Celý postup je v lib/liveRecording.ts.
 */

export type RecordingVisibility = 'public' | 'subscribers' | 'private';
export const RECORDING_VISIBILITIES: RecordingVisibility[] = ['public', 'subscribers', 'private'];

export function parseRecordingVisibility(value: unknown): RecordingVisibility | null {
  return typeof value === 'string' && (RECORDING_VISIBILITIES as string[]).includes(value) ? (value as RecordingVisibility) : null;
}

/** Záznamy hledané pro "poslední" (latest) - starší než tohle už k právě skončenému vysílání nepatří. */
export const LATEST_MAX_AGE_MS = 48 * 60 * 60 * 1000;

type RecordingLike = { uid: string; created: string | null };

/**
 * Který záznam zveřejnit: zadaný (musí patřit k vstupu kanálu - hledá se
 * jen v jeho seznamu), nebo "latest" = nejnovější z posledních 48 hodin,
 * který ještě není mezi `published`.
 */
export function pickRecording<T extends RecordingLike>(recordings: T[], wanted: string, published: Set<string>, now = Date.now()): T | null {
  if (wanted && wanted !== 'latest') return recordings.find((r) => r.uid === wanted) ?? null;
  const fresh = recordings
    .filter((r) => !published.has(r.uid))
    .filter((r) => !r.created || now - new Date(r.created).getTime() < LATEST_MAX_AGE_MS)
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
  return fresh[0] ?? null;
}

/**
 * Rezerva okna vysílání: Cloudflare založí záznam pár vteřin před "vysílám" v appce.
 * Rozdíl hodin počítače a serveru okno nerozhodí - server si ho posune podle
 * `clientNow` (clockSkew). Malá rezerva = záznam minulého krátkého vysílání
 * těsně před tímhle se nezahodí s ním.
 */
export const WINDOW_BEFORE_MS = 60 * 1000;
export const WINDOW_AFTER_MS = 30 * 1000;

/**
 * O kolik jdou hodiny serveru napřed proti hodinám appky (ms; záporné = appka
 * napřed). `clientNow` = čas appky v okamžiku požadavku. Bez něj (nebo nesmysl,
 * víc než týden) 0 - okno se bere, jak přišlo.
 */
export function clockSkew(clientNow: unknown, now = Date.now()): number {
  const c = typeof clientNow === 'number' ? clientNow : typeof clientNow === 'string' && clientNow.trim() ? Number(clientNow) : NaN;
  if (!Number.isFinite(c) || c <= 0) return 0;
  const skew = now - c;
  return Math.abs(skew) > 7 * 24 * 60 * 60 * 1000 ? 0 : Math.round(skew);
}

/**
 * Záznamy jednoho vysílání podle času (appka nezná id záznamu - Cloudflare
 * přenos za vysílání nepotvrdil): všechny, které vznikly mezi začátkem
 * (s rezervou) a koncem vysílání. Vysílání s výpadkem delším než minuta má
 * záznamů víc - zahodit se mají všechny. Bez zveřejněných (ty jsou videem
 * na Kine) a bez právě běžícího (`keep` - nové vysílání).
 */
export function recordingsInWindow<T extends RecordingLike>(
  recordings: T[],
  window: { since: number; until: number },
  options: { published?: Set<string>; keep?: string | null } = {}
): T[] {
  const from = window.since - WINDOW_BEFORE_MS;
  const to = window.until + WINDOW_AFTER_MS;
  return recordings.filter((r) => {
    if (options.published?.has(r.uid) || (options.keep && r.uid === options.keep)) return false;
    const created = r.created ? Date.parse(r.created) : NaN;
    return Number.isFinite(created) && created >= from && created <= to;
  });
}

/**
 * Okno vysílání z požadavku appky (ms od epochy, hodiny appky) -> čas serveru
 * (posunuté o clockSkew podle `clientNow`); null = nesmysl (konec před
 * začátkem, delší než 2 dny, budoucnost, staré).
 */
export function parseStreamWindow(since: unknown, until: unknown, now = Date.now(), clientNow: unknown = null): { since: number; until: number } | null {
  const rawSince = Number(since);
  const rawUntil = Number(until);
  if (!Number.isFinite(rawSince) || !Number.isFinite(rawUntil) || rawSince <= 0 || rawUntil < rawSince) return null;
  const skew = clockSkew(clientNow, now);
  const s = rawSince + skew;
  const u = rawUntil + skew;
  if (u - s > 48 * 60 * 60 * 1000 || u > now + 5 * 60 * 1000 || now - u > 7 * 24 * 60 * 60 * 1000) return null;
  return { since: s, until: u };
}

export function defaultRecordingTitle(created: string | null): string {
  const date = created ? new Date(created) : new Date();
  return `Live stream ${date.toISOString().slice(0, 10)}`;
}
