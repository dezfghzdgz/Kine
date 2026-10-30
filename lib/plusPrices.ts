import Stripe from 'stripe';
import { PAID_TIERS, tierStripePriceId, type PaidTier, type ShownCurrency } from './plus';
import { keyMode, stripeMissing } from './stripeSetup';

/**
 * Ceny Kine Plus přímo ze Stripe - jediný zdroj pravdy pro stránku /plus,
 * appku do PC i nákup (/api/plus/checkout).
 *
 * Pořadí pro každou variantu:
 *  1. cena v EUR z /admin/stripe (lookup_key kine_plus_<tier>_month_eur),
 *  2. cena v USD (kine_plus_<tier>_month_usd),
 *  3. cena z Vercelu (STRIPE_PLUS_*_PRICE_ID) - třeba starší v korunách.
 * Po „Vytvořit ceny ve Stripe“ v /admin/stripe tak web prodává za nové ceny
 * sám (do pár minut) - do Vercelu se nic kopírovat nemusí.
 *
 * Ukazují se jen eura a dolary (koruny nikdy): z hlavní měny ceny a z jejích
 * dalších měn (currency_options). Výsledek se pamatuje 5 minut na instanci
 * serveru - Stripe se neptá při každém otevření stránky.
 */

export const PLUS_PRICE_CURRENCIES: readonly ShownCurrency[] = ['eur', 'usd'];

export function plusLookupKey(tier: PaidTier, currency: string): string {
  return `kine_plus_${tier}_month_${currency}`;
}

/** Ta část ceny u Stripe, kterou Kine potřebuje (Stripe.Price i testovací objekt). */
export type PriceLike = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  lookup_key?: string | null;
  recurring?: { interval?: string | null; interval_count?: number | null } | null;
  currency_options?: Record<string, { unit_amount?: number | null } | undefined> | null;
};

const sellable = (p: PriceLike | null | undefined): p is PriceLike =>
  !!p && p.active && p.recurring?.interval === 'month' && (p.recurring?.interval_count ?? 1) === 1 && (p.unit_amount ?? 0) > 0;

/** Kterou cenu varianty prodávat (viz pořadí nahoře); nic prodejného -> null. */
export function pickTierPrice(tier: PaidTier, listed: PriceLike[], envPrice: PriceLike | null): PriceLike | null {
  for (const currency of PLUS_PRICE_CURRENCIES) {
    const hit = listed.find((p) => p.lookup_key === plusLookupKey(tier, currency) && sellable(p));
    if (hit) return hit;
  }
  return sellable(envPrice) ? envPrice : null;
}

/** Částky k ukázání v setinách: eura a dolary (hlavní měna nebo další měna ceny). */
export function priceAmounts(p: PriceLike): Record<ShownCurrency, number | null> {
  const out: Record<ShownCurrency, number | null> = { eur: null, usd: null };
  for (const currency of PLUS_PRICE_CURRENCIES) {
    const amount = p.currency === currency ? p.unit_amount : p.currency_options?.[currency]?.unit_amount;
    if (typeof amount === 'number' && amount > 0) out[currency] = amount;
  }
  return out;
}

/** Země, kde se platí dolary - Stripe tam u ceny s USD ukáže dolary, stránka taky. */
const USD_COUNTRIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM', 'EC', 'SV', 'PA', 'TL', 'FM', 'MH', 'PW', 'BQ', 'TC', 'VG', 'ZW']);

export function shownCurrencyFor(country: string | null | undefined): ShownCurrency {
  return country && USD_COUNTRIES.has(country.trim().toUpperCase()) ? 'usd' : 'eur';
}

export type ResolvedTier = { priceId: string; currency: string; amounts: Record<ShownCurrency, number | null> };
/** ok = Stripe odpověděl (false = nevíme - nákup pak zkusí cenu z Vercelu). */
export type ResolvedPrices = { ok: boolean; tiers: Record<PaidTier, ResolvedTier | null> };

const EMPTY: Record<PaidTier, ResolvedTier | null> = { kine: null, clips: null, all: null };
const TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 30_000;
let cached: { at: number; ttl: number; value: ResolvedPrices } | null = null;
let inflight: Promise<ResolvedPrices> | null = null;

function client(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  const mode = keyMode(key);
  return mode === 'test' || mode === 'live' ? new Stripe(key!.trim(), { apiVersion: '2024-06-20' }) : null;
}

async function resolve(): Promise<ResolvedPrices> {
  const stripe = client();
  if (!stripe) return { ok: false, tiers: { ...EMPTY } };
  const keys = PAID_TIERS.flatMap((tier) => PLUS_PRICE_CURRENCIES.map((c) => plusLookupKey(tier, c)));
  const listed = (await stripe.prices.list({ lookup_keys: keys, active: true, limit: 10, expand: ['data.currency_options'] })).data as unknown as PriceLike[];
  const tiers: Record<PaidTier, ResolvedTier | null> = { ...EMPTY };
  for (const tier of PAID_TIERS) {
    let price = pickTierPrice(tier, listed, null);
    const envId = tierStripePriceId(tier);
    if (!price && envId) {
      // Neexistující cena (jiný režim, smazaná) = varianta se neprodává; jiná chyba = nevíme (ok: false).
      const envPrice = await stripe.prices.retrieve(envId, { expand: ['currency_options'] }).catch((e) => {
        if (stripeMissing(e)) return null;
        throw e;
      });
      price = pickTierPrice(tier, [], envPrice as unknown as PriceLike | null);
    }
    tiers[tier] = price ? { priceId: price.id, currency: price.currency, amounts: priceAmounts(price) } : null;
  }
  return { ok: true, tiers };
}

/** Ceny všech variant (z paměti, nebo čerstvě ze Stripe). Nikdy nevyhodí chybu. */
export async function getPlusPrices(opts: { fresh?: boolean } = {}): Promise<ResolvedPrices> {
  if (!opts.fresh && cached && Date.now() - cached.at < cached.ttl) return cached.value;
  if (inflight) return inflight;
  inflight = resolve()
    .catch((e) => {
      console.warn('Kine Plus: ceny ze Stripe se nepodařilo načíst -', String(e?.message ?? e).slice(0, 160));
      return { ok: false, tiers: { ...EMPTY } } as ResolvedPrices;
    })
    .then((value) => {
      cached = { at: Date.now(), ttl: value.ok ? TTL_MS : FAIL_TTL_MS, value };
      inflight = null;
      return value;
    });
  return inflight;
}

/** Zapomenout uložené ceny (po vytvoření nových v /admin/stripe, po chybě nákupu). */
export function forgetPlusPrices(): void {
  cached = null;
}

/** Cena varianty k nákupu: ze Stripe, a když Stripe neodpověděl, aspoň ta z Vercelu. */
export async function tierPriceIdForCheckout(tier: PaidTier): Promise<{ priceId: string | null; fromStripe: boolean }> {
  const live = await getPlusPrices();
  if (live.ok) return { priceId: live.tiers[tier]?.priceId ?? null, fromStripe: true };
  return { priceId: tierStripePriceId(tier), fromStripe: false };
}

/** Popisky pro appku do PC: „€2.49“ (v USA „$2.99“) - bez korun. */
export function shownLabels(prices: ResolvedPrices, currency: ShownCurrency, format: (cents: number, currency: ShownCurrency) => string): Record<PaidTier, string | null> {
  const out: Record<PaidTier, string | null> = { kine: null, clips: null, all: null };
  for (const tier of PAID_TIERS) {
    const amounts = prices.tiers[tier]?.amounts;
    if (!amounts) continue;
    const cur: ShownCurrency | null = amounts[currency] ? currency : amounts.eur ? 'eur' : amounts.usd ? 'usd' : null;
    out[tier] = cur ? format(amounts[cur] as number, cur) : null;
  }
  return out;
}
