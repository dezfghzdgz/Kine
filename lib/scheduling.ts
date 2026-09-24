/**
 * Naplánovaná videa a premiéry.
 *
 * - Naplánované video (bez premiéry) do času zveřejnění nikde není - vidí
 *   ho jen majitel.
 * - Premiéra je vidět předem jako "připravuje se" (s odpočtem), přehrát
 *   jde až v čase premiéry.
 *
 * Čistá logika bez databáze - má test.
 */

type Scheduled = { scheduled_at?: string | null; is_premiere?: boolean | null };

/** Filtr pro Supabase .or(): co už je zveřejněné, nebo je to premiéra (ukazuje se předem). */
export function visibleNowFilter(nowIso = new Date().toISOString()): string {
  return `scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`;
}

/** Zveřejní se až v budoucnu? */
export function isUpcoming(video: Scheduled | null | undefined, now = Date.now()): boolean {
  if (!video?.scheduled_at) return false;
  const at = new Date(video.scheduled_at).getTime();
  return Number.isFinite(at) && at > now;
}

/** Premiéra, která ještě nezačala. */
export function isUpcomingPremiere(video: Scheduled | null | undefined, now = Date.now()): boolean {
  return !!video?.is_premiere && isUpcoming(video, now);
}

/** Naplánované video (ne premiéra), které ještě není zveřejněné - ostatním se nesmí ukázat. */
export function isHiddenScheduled(video: Scheduled | null | undefined, now = Date.now()): boolean {
  return !video?.is_premiere && isUpcoming(video, now);
}

/** Odpočet: "2 d 03:15:20", "03:15:20" nebo "15:20". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = hours > 0 || days > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  return days > 0 ? `${days} d ${clock}` : clock;
}
