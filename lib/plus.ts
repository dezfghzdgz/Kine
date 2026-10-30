/**
 * Předplatné Kine - jedno místo pro pravidla, ať je web i appka do PC
 * čtou stejně (v appce src/shared/plan.ts).
 *
 * Tři placené varianty, každá vlastní cena u Stripe:
 *  - 'kine'  Kine Plus:  web jako YouTube Premium - odznak PLUS u jména,
 *            3× víc nahrávání (délka videa, počet a minuty za den, úložiště -
 *            lib/uploadLimits.ts).
 *  - 'clips' Klipy Plus: appka do PC nahrává klipy automaticky (po hře,
 *            nikdy během ní), klipy až 5 minut.
 *  - 'all'   Kine Plus + Klipy: obojí.
 *  - 'plus'  starší hodnota z první verze = 'all'.
 * Základ ('free'): klipování v appce bez omezení, klipy do 60 s, nahrání
 * ručně - se stejnými pravidly jako každé video.
 */
export type Plan = 'free' | 'kine' | 'clips' | 'all' | 'plus';
export type PaidTier = 'kine' | 'clips' | 'all';

export const PAID_TIERS: PaidTier[] = ['kine', 'clips', 'all'];

export const FREE_CLIP_MAX_SECONDS = 60;
export const PLUS_CLIP_MAX_SECONDS = 300;
/** Kine Plus: kolikrát víc nahrávání než základ (lib/uploadLimits.ts - PLUS_UPLOAD_MULTIPLIER). */
export const KINE_PLUS_UPLOAD_MULTIPLIER = 3;

export function normalizePlan(value: unknown): Plan {
  return value === 'kine' || value === 'clips' || value === 'all' || value === 'plus' ? value : 'free';
}

/** Platí plán právě teď? (null plan_until = bez konce) */
function activeNow(planUntil: string | null | undefined, now: number): boolean {
  if (!planUntil) return true;
  const until = new Date(planUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/** Jakékoliv placené předplatné platné právě teď. */
export function hasPlus(plan: string | null | undefined, planUntil: string | null | undefined, now = Date.now()): boolean {
  return normalizePlan(plan) !== 'free' && activeNow(planUntil, now);
}

/** Kine Plus (web): 'kine', 'all' nebo starší 'plus'. */
export function hasKinePlus(plan: string | null | undefined, planUntil: string | null | undefined, now = Date.now()): boolean {
  const p = normalizePlan(plan);
  return (p === 'kine' || p === 'all' || p === 'plus') && activeNow(planUntil, now);
}

/** Klipy Plus (appka): 'clips', 'all' nebo starší 'plus'. */
export function hasClipsPlus(plan: string | null | undefined, planUntil: string | null | undefined, now = Date.now()): boolean {
  const p = normalizePlan(plan);
  return (p === 'clips' || p === 'all' || p === 'plus') && activeNow(planUntil, now);
}

/**
 * Popisek ceny bez období: „59 Kč / měsíc (2,49 €)“ -> „59 Kč (2,49 €)“. Období
 * („/ month“, „/ měsíc“…) doplní stránka v jazyce webu - v popisku z Vercelu
 * by bylo jen česky.
 */
export function stripPricePeriod(label: string): string {
  return label
    .replace(/\s*\/\s*(?:měsíc|mesiac|mesic|měs\.|mes\.|month|mo\.|mo)(?=\s|\(|$)/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** „59 Kč (2,49 €)“ -> { main: „59 Kč“, extra: „2,49 €“ } (druhá měna nepovinná). */
export function splitPriceLabel(label: string): { main: string; extra: string | null } {
  const clean = stripPricePeriod(label);
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(clean);
  return m && m[1].trim() ? { main: m[1].trim(), extra: m[2].trim() } : { main: clean, extra: null };
}

/** Jazyk webu -> formát čísel a měny (eura a dolary se píšou podle zvyklostí jazyka). */
const MONEY_LOCALE: Record<string, string> = { cs: 'cs-CZ', sk: 'sk-SK', en: 'en-IE', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', pl: 'pl-PL', uk: 'uk-UA' };

/** Ceny Kine Plus se ukazují jen v eurech nebo dolarech - koruny nikdy (rozhodnutí: Kine je mezinárodní). */
export type ShownCurrency = 'eur' | 'usd';

/** 249 + 'eur' -> „€2.49“ (en) / „2,49 €“ (cs); 300 -> „€3“. */
export function formatPlusAmount(cents: number, currency: string, lang = 'en'): string {
  const cur = currency.toUpperCase();
  const value = cents / 100;
  const locale = cur === 'USD' && lang === 'en' ? 'en-US' : MONEY_LOCALE[lang] ?? 'en-IE';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: cur,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${cur}`;
  }
}

/** „2,49 €“ / „€2.49“ / „$2.99“ / „2.49 EUR“ -> { cents, currency }; koruny a nesmysl -> null. */
export function parseShownAmount(text: string): { cents: number; currency: ShownCurrency } | null {
  const t = text.trim();
  if (/kč|czk/i.test(t)) return null;
  const currency: ShownCurrency | null = /€|\beur\b/i.test(t) ? 'eur' : /\$|\busd\b/i.test(t) ? 'usd' : null;
  const num = /(\d{1,5})(?:[.,](\d{1,2}))?/.exec(t);
  if (!currency || !num) return null;
  const cents = Number(num[1]) * 100 + (num[2] ? Number(num[2].padEnd(2, '0')) : 0);
  return cents > 0 ? { cents, currency } : null;
}

/**
 * Náhradní cena ze starého popisku ve Vercelu (když se ceny ze Stripe nedají
 * načíst): jen eurová nebo dolarová část - „59 Kč (2,49 €)“ -> „€2.49“.
 * Popisek jen v korunách -> null (koruny se neukazují).
 */
export function shownPriceFromLabel(label: string | null | undefined, lang = 'en'): string | null {
  if (!label) return null;
  const { main, extra } = splitPriceLabel(label);
  for (const part of [main, extra]) {
    const parsed = part ? parseShownAmount(part) : null;
    if (parsed) return formatPlusAmount(parsed.cents, parsed.currency, lang);
  }
  return null;
}

/** Cena, jak se ukazuje lidem - text z prostředí (bez období), ať jde měnit bez nasazení kódu. */
export function tierPriceLabel(tier: PaidTier): string | null {
  const byTier: Record<PaidTier, string | undefined> = {
    kine: process.env.NEXT_PUBLIC_PLUS_KINE_PRICE_LABEL,
    clips: process.env.NEXT_PUBLIC_PLUS_CLIPS_PRICE_LABEL,
    all: process.env.NEXT_PUBLIC_PLUS_ALL_PRICE_LABEL || process.env.NEXT_PUBLIC_PLUS_PRICE_LABEL,
  };
  const label = byTier[tier]?.trim();
  return label ? stripPricePeriod(label) || null : null;
}

/** Ceny všech tří variant (pro /plus a pro appku). */
export function allPriceLabels(): Record<PaidTier, string | null> {
  return { kine: tierPriceLabel('kine'), clips: tierPriceLabel('clips'), all: tierPriceLabel('all') };
}

/** Stripe Price ID varianty (jen na serveru). Starší STRIPE_PLUS_PRICE_ID = varianta 'all'. */
export function tierStripePriceId(tier: PaidTier): string | null {
  const byTier: Record<PaidTier, string | undefined> = {
    kine: process.env.STRIPE_PLUS_KINE_PRICE_ID,
    clips: process.env.STRIPE_PLUS_CLIPS_PRICE_ID,
    all: process.env.STRIPE_PLUS_ALL_PRICE_ID || process.env.STRIPE_PLUS_PRICE_ID,
  };
  return byTier[tier] || null;
}

/** Varianta podle Stripe Price ID (webhook, když v metadatech chybí tier). */
export function tierFromStripePriceId(priceId: string | null | undefined): PaidTier | null {
  if (!priceId) return null;
  for (const tier of PAID_TIERS) if (tierStripePriceId(tier) === priceId) return tier;
  return null;
}

/** Dá se koupit aspoň jedna varianta? */
export function anyTierAvailable(): boolean {
  return PAID_TIERS.some((tier) => Boolean(tierStripePriceId(tier)));
}

export function isPaidTier(value: unknown): value is PaidTier {
  return value === 'kine' || value === 'clips' || value === 'all';
}

/** Starší volání: cena "Kine Plus" = varianta 'all'. */
export function plusPriceLabel(): string | null {
  return tierPriceLabel('all');
}
