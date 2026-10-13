/**
 * Příspěvky a ankety - čistá pravidla bez prohlížeče (tests/posts.test.mjs).
 *
 * Příspěvek má text, až MAX_POST_IMAGES fotek (image_urls; starší jen
 * image_url), volitelně video z Kine (video_id) a anketu (poll_options,
 * konec poll_ends_at). Sloupce přidává migrace
 * supabase-migration-posty-ankety.sql - bez ní funguje jedna fotka
 * a anketa bez konce jako dřív.
 */

export const MAX_POST_IMAGES = 4;
export const MAX_POLL_OPTIONS = 6;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POST_TEXT = 5000;

export type PollOption = { text: string; votes?: number };
/** Jak dlouho anketa běží (hodiny); 0 = bez konce. */
export const POLL_DURATIONS_H = [24, 72, 168, 0] as const;
export type PollDuration = (typeof POLL_DURATIONS_H)[number];

/** Fotky příspěvku (nové pole i starý jeden obrázek), jen https, bez opakování, nejvýš 4. */
export function postImages(post: { image_urls?: unknown; image_url?: unknown } | null | undefined): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && /^https:\/\//i.test(v.trim()) && !out.includes(v.trim()) && out.length < MAX_POST_IMAGES) out.push(v.trim());
  };
  if (Array.isArray(post?.image_urls)) post!.image_urls.forEach(add);
  add(post?.image_url);
  return out;
}

/** Konec ankety pro zvolenou délku (null = bez konce). */
export function pollEndsAt(hours: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(now + hours * 3600 * 1000).toISOString();
}

/** Možnosti ankety z formuláře: oříznuté, neprázdné, bez opakování, 2-6. null = málo možností. */
export function cleanPollOptions(raw: readonly string[]): PollOption[] | null {
  const seen = new Set<string>();
  const out: PollOption[] = [];
  for (const r of raw) {
    const text = String(r ?? '').trim().slice(0, 120);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ text, votes: 0 });
    if (out.length >= MAX_POLL_OPTIONS) break;
  }
  return out.length >= MIN_POLL_OPTIONS ? out : null;
}

export type PollView = {
  total: number;
  ended: boolean;
  endsAt: string | null;
  /** Ukázat výsledky: po hlasování, po konci, nebo majiteli. */
  showResults: boolean;
  /** Jde hlasovat / změnit hlas (do konce ankety). */
  canVote: boolean;
  /** Možnost s nejvíc hlasy (při shodě první); null = žádné hlasy. */
  winner: number | null;
};

export function pollState(input: { options: readonly PollOption[]; endsAt: string | null | undefined; voted: boolean; own: boolean; now?: number }): PollView {
  const now = input.now ?? Date.now();
  const end = input.endsAt ? Date.parse(input.endsAt) : NaN;
  const ended = Number.isFinite(end) && end <= now;
  const total = input.options.reduce((sum, o) => sum + (Number(o?.votes) > 0 ? Math.floor(Number(o.votes)) : 0), 0);
  let winner: number | null = null;
  let best = 0;
  input.options.forEach((o, i) => {
    const v = Number(o?.votes) || 0;
    if (v > best) {
      best = v;
      winner = i;
    }
  });
  return {
    total,
    ended,
    endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
    showResults: input.voted || ended || input.own,
    canVote: !ended,
    winner,
  };
}

/** Příspěvky na kanálu: připnuté nahoře (nejnověji připnutý první), pak od nejnovějšího. */
export function sortPosts<T extends { created_at: string; pinned_at?: string | null }>(posts: readonly T[]): T[] {
  const t = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);
  return [...posts].sort((a, b) => {
    const pa = t(a.pinned_at);
    const pb = t(b.pinned_at);
    if ((pa > 0) !== (pb > 0)) return pa > 0 ? -1 : 1;
    if (pa !== pb) return pb - pa;
    return t(b.created_at) - t(a.created_at);
  });
}

/** Id videa z odkazu na Kine (/watch/<uuid>, ?v=, nebo holé uuid). null = není to video z Kine. */
export function videoIdFromLink(text: string): string | null {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(String(text ?? ''));
  return m ? m[1].toLowerCase() : null;
}
