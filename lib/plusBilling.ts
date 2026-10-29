import { isPaidTier, type PaidTier } from './plus';

/**
 * Předplatné Kine Plus podle stavu u Stripe - do kdy platí a jaká varianta.
 *
 * Pravidla (lib/plus.ts čte jen plan + plan_until):
 *  - aktivní / zkušební: do konce zaplaceného období + 3 dny rezervy
 *    (obnovení se může o den dva zpozdit - ať člověk o nic nepřijde),
 *  - zrušené ke konci období (cancel_at_period_end): přesně do konce
 *    období, bez rezervy - další platba nepřijde,
 *  - nezaplacené obnovení (past_due): ještě 3 dny od začátku nového období,
 *    pak nic. Dřív platilo celé další období zadarmo, než to Stripe vzdal.
 *    Když se platba povede později, Stripe pošle změnu a Plus se vrátí,
 *  - zrušené, nezaplacené po všech pokusech, nedokončené, pozastavené: nic.
 *
 * Bez údajů o období (nemělo by nastat) nejvýš 35 dní - nikdy "napořád".
 * Čistá logika (tests/plus.test.mjs).
 */

export const PLUS_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const FALLBACK_MS = 35 * 24 * 60 * 60 * 1000;

export type PlusState = { plan: PaidTier | 'free'; planUntil: string | null };

function seconds(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function plusFromSubscription(
  sub: any,
  opts: { metadataTier?: unknown; tierFromPrice: (priceId: string | null) => PaidTier | null; now?: number }
): PlusState {
  const now = opts.now ?? Date.now();
  const status = String(sub?.status ?? '');
  if (!sub || !['active', 'trialing', 'past_due'].includes(status)) return { plan: 'free', planUntil: null };

  const item = sub?.items?.data?.[0];
  const priceId: string | null = item?.price?.id ?? sub?.plan?.id ?? null;
  // Varianta: cena z Vercelu, jinak štítek ceny (ceny z /admin/stripe ho mají - platí i pro starší
  // cenu po zdražení a pro přechod na jinou variantu v portálu), až pak štítek předplatného
  // (ten se při přechodu nemění).
  const priceTier = item?.price?.metadata?.tier ?? sub?.plan?.metadata?.tier;
  const tier: PaidTier =
    opts.tierFromPrice(priceId) ?? (isPaidTier(priceTier) ? priceTier : null) ?? (isPaidTier(opts.metadataTier) ? opts.metadataTier : 'all');

  // Novější verze API Stripe mají období u položky předplatného, ne u předplatného.
  const end = seconds(sub.current_period_end) ?? seconds(item?.current_period_end);
  const start = seconds(sub.current_period_start) ?? seconds(item?.current_period_start);
  if (!end) return { plan: tier, planUntil: new Date(now + FALLBACK_MS).toISOString() };

  let untilMs: number;
  if (status === 'past_due') {
    untilMs = (start ? start * 1000 : now) + PLUS_GRACE_MS;
  } else if (sub.cancel_at_period_end === true || seconds(sub.cancel_at)) {
    const cancelAt = seconds(sub.cancel_at);
    untilMs = Math.min(end * 1000, cancelAt ? cancelAt * 1000 : Infinity);
  } else {
    untilMs = end * 1000 + PLUS_GRACE_MS;
  }
  if (untilMs <= now) return { plan: 'free', planUntil: null };
  return { plan: tier, planUntil: new Date(untilMs).toISOString() };
}

/** Id předplatného, ke kterému patří sporná platba (charge s fakturou - starší i novější API Stripe). */
export function subscriptionIdFromCharge(charge: any): string | null {
  const invoice = charge?.invoice;
  if (invoice && typeof invoice === 'object') {
    const direct = invoice.subscription;
    if (typeof direct === 'string' && direct) return direct;
    if (direct && typeof direct.id === 'string') return direct.id;
    const nested = invoice.parent?.subscription_details?.subscription;
    if (typeof nested === 'string' && nested) return nested;
    if (nested && typeof nested.id === 'string') return nested.id;
  }
  return null;
}
