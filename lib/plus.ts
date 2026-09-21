/**
 * Předplatné Kine - jedno místo pro pravidla, ať je web i appka do PC
 * čtou stejně (v appce src/shared/plan.ts).
 *
 * Tři placené varianty, každá vlastní cena u Stripe:
 *  - 'kine'  Kine Plus:  web jako YouTube Premium - odznak PLUS u jména,
 *            3× vyšší denní limit nahrávání.
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
/** Kine Plus: kolikrát vyšší denní limit nahrávání než základ (UPLOAD_DAILY_LIMIT). */
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

/** Cena, jak se ukazuje lidem - text z prostředí, ať jde měnit bez nasazení kódu. */
export function tierPriceLabel(tier: PaidTier): string | null {
  const byTier: Record<PaidTier, string | undefined> = {
    kine: process.env.NEXT_PUBLIC_PLUS_KINE_PRICE_LABEL,
    clips: process.env.NEXT_PUBLIC_PLUS_CLIPS_PRICE_LABEL,
    all: process.env.NEXT_PUBLIC_PLUS_ALL_PRICE_LABEL || process.env.NEXT_PUBLIC_PLUS_PRICE_LABEL,
  };
  return byTier[tier] || null;
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
