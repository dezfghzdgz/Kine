/**
 * 0146: denní rozpočet vysílání na účet (minuty za posledních 24 h):
 * LIVE_DAILY_MINUTES (výchozí 480 = 8 h), s Kine Plus LIVE_DAILY_MINUTES_PLUS
 * (výchozí 960 = 16 h); správci bez stropu. Každá minuta přenosu je minuta
 * záznamu v úložišti - bez stropu by jeden účet s obrázkem 24/7 zaplnil
 * předplacené minuty všem. Po vyčerpání se vstup vypne na hodinu a po
 * hodině se zkusí znovu (přestávka trvá, dokud se okno 24 h neuvolní).
 *
 * Čistá logika bez databáze (tests/liveBudget.test.mjs); samotné vymáhání
 * (dotaz na relace, vypnutí vstupu) je v lib/liveLimits.ts.
 */
export function liveDailyMinutes(plus: boolean, env: Record<string, string | undefined> = process.env): number {
  const n = Number(plus ? env.LIVE_DAILY_MINUTES_PLUS : env.LIVE_DAILY_MINUTES);
  const fallback = plus ? 960 : 480;
  return Number.isFinite(n) && n >= 30 && n <= 1440 ? Math.round(n) : fallback;
}

export const LIVE_BUDGET_COOLDOWN_MINUTES = 60;

/** Minuty vysílání v okně [since, now] ze záznamů relací (začátek, naposledy viděno). Čistá funkce - tests/liveBudget.test.mjs. */
export function liveMinutesInWindow(sessions: { started_at: string; last_seen_at: string }[], now: number, windowMs = 24 * 3600 * 1000): number {
  const since = now - windowMs;
  let ms = 0;
  for (const s of sessions) {
    const a = Math.max(Date.parse(s.started_at), since);
    const b = Math.min(Date.parse(s.last_seen_at), now);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) ms += b - a;
  }
  return Math.round(ms / 60000);
}

/** Je rozpočet vyčerpaný? (čistá) */
export function liveBudgetExceeded(minutesUsed: number, budgetMinutes: number): boolean {
  return budgetMinutes > 0 && minutesUsed >= budgetMinutes;
}
