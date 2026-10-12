/**
 * Podpory ve vysílání (jako Super Chat na YouTube nebo "cheer" na Twitchi):
 * divák pošle tvůrci částku a krátký vzkaz, ten se ukáže zvýrazněný
 * v chatu a tvůrce si ho může nechat přečíst nahlas.
 *
 * Peníze jdou přes Stripe rovnou na Stripe účet tvůrce (Connect), Kine si
 * nechá jen poplatek (LIVE_TIP_FEE_PERCENT, výchozí 15 % - stejně jako
 * u předplatného tvůrce). Čistá logika bez databáze - má test
 * (tests/liveTips.test.mjs).
 */

export type TipCurrency = 'czk' | 'eur';
export const TIP_CURRENCIES: readonly TipCurrency[] = ['czk', 'eur'];

/**
 * Rozsah a nabízené částky (v celých korunách / eurech). Minimum je kvůli
 * poplatku Stripe za platbu kartou (~1,5 % + 0,25 €), který platí Kine
 * ze svého podílu - u menších částek by Kine na každé podpoře prodělalo.
 */
export const TIP_LIMITS: Record<TipCurrency, { min: number; max: number; presets: number[] }> = {
  czk: { min: 50, max: 10000, presets: [50, 100, 200, 500] },
  eur: { min: 2, max: 400, presets: [2, 5, 10, 20] },
};

/** Nejmenší poplatek Kine (pokryje poplatek Stripe za platbu): 8 Kč / 0,30 €. */
export const TIP_MIN_FEE_CENTS: Record<TipCurrency, number> = { czk: 800, eur: 30 };

export const TIP_MESSAGE_MAX = 200;
export const DEFAULT_TIP_FEE_PERCENT = 15;

export function parseTipCurrency(value: unknown): TipCurrency | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (TIP_CURRENCIES as readonly string[]).includes(v) ? (v as TipCurrency) : null;
}

/** Měna podle jazyka diváka: čeština korunami, jinak eura (i Slovensko). */
export function defaultTipCurrency(lang: string | null | undefined): TipCurrency {
  return lang === 'cs' ? 'czk' : 'eur';
}

/**
 * Částka v haléřích / centech, nebo null, když je mimo rozsah. Koruny jen
 * celé (haléře se dnes nepoužívají), eura na centy.
 */
export function tipAmountCents(amount: unknown, currency: TipCurrency): number | null {
  const n = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount.replace(',', '.').trim()) : NaN;
  if (!Number.isFinite(n)) return null;
  const { min, max } = TIP_LIMITS[currency];
  if (n < min || n > max) return null;
  const cents = currency === 'czk' ? Math.round(n) * 100 : Math.round(n * 100);
  return cents >= min * 100 && cents <= max * 100 ? cents : null;
}

/** Poplatek Kine v procentech z proměnné prostředí (0-50, jinak výchozí 15). */
export function tipFeePercent(raw: string | undefined | null): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_TIP_FEE_PERCENT;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > 50) return DEFAULT_TIP_FEE_PERCENT;
  return n;
}

/**
 * Poplatek Kine v haléřích / centech: procento z částky, ale aspoň tolik,
 * kolik si vezme Stripe za platbu (při 0 % žádný). Nikdy víc než celá částka.
 */
export function tipFeeCents(amountCents: number, percent: number, currency: TipCurrency): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !(percent > 0)) return 0;
  const fee = Math.max(TIP_MIN_FEE_CENTS[currency], Math.round((amountCents * percent) / 100));
  return Math.min(amountCents, fee);
}

/** Vzkaz k podpoře: jeden řádek, bez okrajových mezer, nejvýš 200 znaků. */
export function cleanTipMessage(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, TIP_MESSAGE_MAX);
}

/** "100 Kč", "5 €", "2,50 €" - desetiny jen když nějaké jsou. */
export function formatTipAmount(cents: number, currency: string, locale = 'cs'): string {
  const value = cents / 100;
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(value);
  } catch {
    return `${whole ? value : value.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** Kolik z podpory dostane tvůrce (poplatek Stripe za platbu jde z podílu Kine, ne z jeho). */
export function creatorShareCents(amountCents: number, feePercent: number, currency: TipCurrency): number {
  return amountCents - tipFeeCents(amountCents, feePercent, currency);
}
