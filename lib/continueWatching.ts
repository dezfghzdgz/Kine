/**
 * Řádek "Pokračovat ve sledování" na hlavní stránce.
 *
 * Pozici ve videu appka ukládá do databáze už dlouho (proto navazuje i na
 * jiném zařízení), ale na Home s tím nic nebylo. Tohle vybírá, co do řádku
 * patří. Čisté, bez prohlížeče: tests/continueWatching.test.mjs.
 */

/** Pod tolik vteřin se nevyplatí navazovat - to člověk sotva klikl. */
export const MIN_PROGRESS_S = 10;
/** Za touhle hranicí je video prakticky dokoukané. */
export const DONE_FRACTION = 0.95;
/** Zbývá-li míň než tohle, taky se bere jako dokoukané (titulky, outro). */
export const DONE_REMAINING_S = 20;
/** Kolik karet nejvíc. */
export const MAX_ITEMS = 12;
/** O kolik vteřin se navazuje před uloženou pozicí, aby divák chytil nit. */
export const RESUME_REWIND_S = 3;

export interface HistoryRow {
  video_id: string;
  progress_seconds: number | null;
  completed: boolean | null;
  watched_at: string | null;
  videos: {
    id: string;
    title?: string | null;
    thumbnail_url?: string | null;
    duration_seconds?: number | null;
    status?: string | null;
    [k: string]: unknown;
  } | null;
}

export interface ContinueItem {
  video: NonNullable<HistoryRow['videos']>;
  /** 0-100 pro proužek pod náhledem. */
  percent: number;
  /** Kam se má video pustit (parametr ?t=). */
  resumeAt: number;
  watchedAt: number;
}

/**
 * Z řádků historie vybere, co se má nabídnout k dokoukání.
 *
 * Vyhazuje dokoukané (příznak i podle času), sotva načatá, videa bez
 * délky (bez ní nejde říct, kolik zbývá) a videa, která nejsou hotová
 * nebo už neexistují. Nejnovější napřed, jedno video jednou, nejvíc
 * MAX_ITEMS.
 */
export function pickContinueWatching(rows: HistoryRow[]): ContinueItem[] {
  const seen = new Set<string>();
  const out: ContinueItem[] = [];

  const sorted = [...rows].sort((a, b) => toTime(b.watched_at) - toTime(a.watched_at));

  for (const row of sorted) {
    const video = row.videos;
    if (!video || !video.id) continue;
    if (seen.has(video.id)) continue;
    if (row.completed) continue;
    if (video.status && video.status !== 'ready') continue;

    const duration = video.duration_seconds ?? 0;
    const progress = row.progress_seconds ?? 0;
    if (!(duration > 0)) continue;
    if (progress < MIN_PROGRESS_S) continue;
    if (progress / duration >= DONE_FRACTION) continue;
    if (duration - progress < DONE_REMAINING_S) continue;

    seen.add(video.id);
    out.push({
      video,
      percent: Math.min(100, Math.max(0, Math.round((progress / duration) * 100))),
      resumeAt: Math.max(0, Math.floor(progress - RESUME_REWIND_S)),
      watchedAt: toTime(row.watched_at),
    });

    if (out.length >= MAX_ITEMS) break;
  }

  return out;
}

function toTime(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}
