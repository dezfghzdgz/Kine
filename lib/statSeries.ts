/**
 * Události v čase pro grafy statistik (odběry, zhlédnutí, lajky...).
 *
 * Každý bod má váhu: odběr = 1, ale zhlédnutí chodí z databáze už sečtená
 * po dnech (creator_views_summary) - den s 5000 zhlédnutími je jeden bod
 * s n = 5000, ne 5000 objektů v paměti prohlížeče.
 */
export type TimePoint = { t: number; n: number };
export type SeriesRange = 'all' | 'year' | 'month' | 'week';

const DAY = 24 * 60 * 60 * 1000;

/** Data (Date nebo text) -> body s váhou 1; neplatná data se zahodí. */
export function pointsFromDates(dates: readonly (Date | string | null | undefined)[]): TimePoint[] {
  const out: TimePoint[] = [];
  for (const d of dates) {
    if (!d) continue;
    const t = d instanceof Date ? d.getTime() : Date.parse(d);
    if (Number.isFinite(t)) out.push({ t, n: 1 });
  }
  return out;
}

/** Součty po dnech ('YYYY-MM-DD', počet) -> body (poledne místního času toho dne). */
export function pointsFromDaily(daily: unknown): TimePoint[] {
  if (!Array.isArray(daily)) return [];
  const out: TimePoint[] = [];
  for (const row of daily) {
    if (!Array.isArray(row)) continue;
    const [day, count] = row;
    const n = Number(count);
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(n) || n <= 0) continue;
    const [y, m, d] = day.split('-').map(Number);
    out.push({ t: new Date(y, m - 1, d, 12).getTime(), n: Math.floor(n) });
  }
  return out;
}

/** Kolik přibylo za posledních `days` dní. */
export function recentTotal(points: readonly TimePoint[], days = 28, now = Date.now()): number {
  const since = now - days * DAY;
  let sum = 0;
  for (const p of points) if (p.t >= since && p.t <= now) sum += p.n;
  return sum;
}

/** Celkem. */
export function totalOf(points: readonly TimePoint[]): number {
  let sum = 0;
  for (const p of points) sum += p.n;
  return sum;
}

/**
 * Kumulativní řada pro graf: hodnota v každém kroku = kolik událostí bylo
 * do té chvíle. Krok: týden a měsíc po dnech, rok po týdnech, vše po 30 dnech.
 * Poslední bod = teď. Seřadí a sečte jednou, pak binární hledání (dřív se
 * pro každý bod procházelo všechno znovu).
 */
export function cumulativeSeries(points: readonly TimePoint[], range: SeriesRange, now = Date.now()): { t: number; count: number; isNow?: boolean }[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const prefix: number[] = new Array(sorted.length);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i].n;
    prefix[i] = acc;
  }
  // Kolik událostí bylo do času t (včetně).
  const upTo = (t: number) => {
    let lo = 0;
    let hi = sorted.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].t <= t) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found < 0 ? 0 : prefix[found];
  };

  const start =
    range === 'week' ? now - 7 * DAY : range === 'month' ? now - 30 * DAY : range === 'year' ? now - 365 * DAY : sorted[0].t;
  const step = (range === 'week' || range === 'month' ? 1 : range === 'year' ? 7 : 30) * DAY;
  const out: { t: number; count: number; isNow?: boolean }[] = [];
  // Pojistka: nejvýš ~400 bodů i u hodně starého kanálu.
  const stepSafe = Math.max(step, Math.ceil((now - start) / 400 / DAY) * DAY);
  for (let cursor = start; cursor <= now; cursor += stepSafe) out.push({ t: cursor, count: upTo(cursor) });
  out.push({ t: now, count: upTo(now), isNow: true });
  return out;
}
