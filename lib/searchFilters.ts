/**
 * Filtry hledání (jako na YouTube): typ, kdy bylo nahráno, délka, řazení.
 * Server (app/search/page.tsx) je použije na výsledky, stránka je ukazuje
 * jako přepínače. Čistá logika - má test.
 */

export type SearchType = 'all' | 'long' | 'sparks';
export type SearchDate = 'any' | 'hour' | 'today' | 'week' | 'month' | 'year';
export type SearchDuration = 'any' | 'short' | 'medium' | 'long';
export type SearchSort = 'relevance' | 'date' | 'views';

export type SearchFilters = { type: SearchType; date: SearchDate; duration: SearchDuration; sort: SearchSort };

export const DEFAULT_FILTERS: SearchFilters = { type: 'all', date: 'any', duration: 'any', sort: 'relevance' };

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseSearchFilters(params: Record<string, string | string[] | undefined>): SearchFilters {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    type: pick(one('type'), ['all', 'long', 'sparks'] as const, 'all'),
    date: pick(one('date'), ['any', 'hour', 'today', 'week', 'month', 'year'] as const, 'any'),
    duration: pick(one('duration'), ['any', 'short', 'medium', 'long'] as const, 'any'),
    sort: pick(one('sort'), ['relevance', 'date', 'views'] as const, 'relevance'),
  };
}

export function filtersActive(f: SearchFilters): boolean {
  return f.type !== 'all' || f.date !== 'any' || f.duration !== 'any' || f.sort !== 'relevance';
}

const DATE_WINDOW_MS: Record<Exclude<SearchDate, 'any'>, number> = {
  hour: 60 * 60 * 1000,
  today: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 31 * 24 * 60 * 60 * 1000,
  year: 366 * 24 * 60 * 60 * 1000,
};

type Row = {
  created_at?: string | null;
  scheduled_at?: string | null;
  is_premiere?: boolean | null;
  duration_seconds?: number | null;
  views?: number | null;
  width?: number | null;
  height?: number | null;
};

/**
 * Filtr a řazení. `isSpark` dodá volající (lib/videoBlocks.ts), ať tu
 * nejsou dvě definice "Sparku". Naplánovaná videa (ne premiéry), která ještě
 * nejsou zveřejněná, vypadnou vždycky.
 */
export function applySearchFilters<T extends Row>(rows: T[], f: SearchFilters, isSpark: (row: T) => boolean, now = Date.now()): T[] {
  const published = (row: T) => {
    const at = row.scheduled_at ? new Date(row.scheduled_at).getTime() : NaN;
    return !(Number.isFinite(at) && at > now && !row.is_premiere);
  };
  const shown = (row: T) => {
    const at = row.scheduled_at && new Date(row.scheduled_at).getTime() > (row.created_at ? new Date(row.created_at).getTime() : 0) ? row.scheduled_at : row.created_at;
    return at ? new Date(at).getTime() : 0;
  };
  let out = rows.filter(published);
  if (f.type === 'sparks') out = out.filter(isSpark);
  if (f.type === 'long') out = out.filter((r) => !isSpark(r));
  if (f.date !== 'any') {
    // Premiéra, která ještě nezačala, "nahraná" ještě není - do filtru podle data nepatří.
    const since = now - DATE_WINDOW_MS[f.date];
    out = out.filter((r) => shown(r) >= since && shown(r) <= now);
  }
  if (f.duration !== 'any') {
    out = out.filter((r) => {
      const d = r.duration_seconds ?? 0;
      if (f.duration === 'short') return d > 0 && d < 4 * 60;
      if (f.duration === 'medium') return d >= 4 * 60 && d <= 20 * 60;
      return d > 20 * 60;
    });
  }
  if (f.sort === 'date') out = [...out].sort((a, b) => shown(b) - shown(a));
  if (f.sort === 'views') out = [...out].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  return out;
}

/** Adresa hledání se změněným filtrem (ostatní parametry zůstanou). */
export function searchHref(query: string, f: SearchFilters, change: Partial<SearchFilters>, minRating?: string | null): string {
  const next = { ...f, ...change };
  const params = new URLSearchParams();
  params.set('q', query);
  if (minRating) params.set('minRating', minRating);
  if (next.type !== 'all') params.set('type', next.type);
  if (next.date !== 'any') params.set('date', next.date);
  if (next.duration !== 'any') params.set('duration', next.duration);
  if (next.sort !== 'relevance') params.set('sort', next.sort);
  return `/search?${params.toString()}`;
}
