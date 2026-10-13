/**
 * "Před 3 hodinami" v jazyce diváka - podle prohlížeče (Intl.RelativeTimeFormat),
 * bez překladů navíc. U komentářů, příspěvků a oznámení; přesné datum je
 * v nápovědě (title). Čistá funkce - tests/timeAgo.test.mjs.
 */

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

export function timeAgo(iso: string | null | undefined, locale: string, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  if (abs < 45) return rtf.format(0, 'second');
  if (abs < 45 * MIN) return rtf.format(Math.round(diff / MIN), 'minute');
  if (abs < 22 * HOUR) return rtf.format(Math.round(diff / HOUR), 'hour');
  if (abs < 6 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  if (abs < 28 * DAY) return rtf.format(Math.round(diff / (7 * DAY)), 'week');
  if (abs < 330 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), 'month');
  return rtf.format(Math.round(diff / (365 * DAY)), 'year');
}
