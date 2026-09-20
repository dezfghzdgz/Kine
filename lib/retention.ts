/**
 * Křivka udržení diváků (tests/retention.test.mjs).
 *
 * Z historie sledování (kam se který divák ve videu dostal) se spočítá,
 * jaký podíl diváků se dostal za každou desetinu/dvacetinu videa. To je
 * ta věc, kterou tvůrci na YouTube milují nejvíc: ukazuje, v které
 * minutě lidi odpadají - a tedy co zkrátit a čím začít.
 *
 * Bereme NEJDÁL dosaženou pozici každého diváka (progress_seconds), ne
 * každou vteřinu sledování - přesnější data by chtěla ukládat každý
 * posun, a to zatím nemáme. Dokoukané řádky (completed) se počítají jako
 * "až do konce", i když progress hlásí míň (progres se ukládá po chvilkách).
 */

export type RetentionRow = { progress_seconds: number | null; completed?: boolean | null };

export type RetentionPoint = {
  /** Začátek dílku v sekundách. */
  at: number;
  /** Podíl diváků, kteří se dostali aspoň sem (0-1). */
  share: number;
};

export const RETENTION_BUCKETS = 20;
/** Pod tolika diváky křivka nic neříká - ukáže se hláška, ne graf. */
export const RETENTION_MIN_VIEWERS = 5;

export function retentionCurve(rows: RetentionRow[], duration: number, buckets = RETENTION_BUCKETS): RetentionPoint[] {
  if (!Number.isFinite(duration) || duration <= 0 || buckets <= 0) return [];

  const reached = rows
    // Bez zaznamenané pozice (null) není co měřit - řádek se vynechá, ne
    // že by se počítal jako divák na nule.
    .map((r) => (r.completed ? duration : r.progress_seconds == null ? NaN : Number(r.progress_seconds)))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .map((v) => Math.min(v, duration));

  if (reached.length === 0) return [];

  const points: RetentionPoint[] = [];
  for (let i = 0; i < buckets; i++) {
    const at = (duration * i) / buckets;
    // První dílek je vždy 100 % - kdo video otevřel, byl na začátku.
    const count = i === 0 ? reached.length : reached.filter((v) => v >= at).length;
    points.push({ at, share: count / reached.length });
  }
  return points;
}

/** Kolik procent diváků dokoukalo aspoň do půlky a do konce (pro souhrn nad grafem). */
export function retentionSummary(points: RetentionPoint[]): { half: number; end: number } | null {
  if (points.length === 0) return null;
  const halfIndex = Math.floor(points.length / 2);
  return { half: points[halfIndex]?.share ?? 0, end: points[points.length - 1]?.share ?? 0 };
}

/**
 * Největší propad mezi dvěma sousedními dílky - "tady lidi odpadají".
 * Vrací začátek dílku, kde propad začal, a velikost propadu; null, když
 * je křivka rovná.
 */
export function biggestDrop(points: RetentionPoint[]): { at: number; drop: number } | null {
  let best: { at: number; drop: number } | null = null;
  for (let i = 1; i < points.length; i++) {
    const drop = points[i - 1].share - points[i].share;
    if (drop > 0 && (!best || drop > best.drop)) best = { at: points[i - 1].at, drop };
  }
  return best;
}
