import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { supabaseServer } from '@/lib/supabaseServer';
import { siteUrlFrom } from '@/lib/siteUrl';
import { CREATOR_PAYMENTS_ENABLED, PAYMENTS_ENABLED } from '@/lib/payments';
import { PAID_TIERS, tierPriceLabel, tierStripePriceId, type PaidTier } from '@/lib/plus';
import { LEGAL_OPERATOR } from '@/lib/operator';
import { PLUS_UPLOAD_MULTIPLIER, storageHoursFromEnv } from '@/lib/uploadLimits';
import {
  REQUIRED_WEBHOOK_EVENTS,
  evaluateSetup,
  isKineWebhookUrl,
  keyMode,
  missingEvents,
  parseAmount,
  priceLabelFor,
  priceProblems,
  sameWebhookUrl,
  webhookUrlFor,
  type PriceInfo,
  type SetupFacts,
} from '@/lib/stripeSetup';

export const dynamic = 'force-dynamic';

/**
 * Nastavení plateb pro správce (stránka /admin/stripe).
 *
 * GET  - kontrola: klíč, účet, webhook, ceny, portál, provozovatel, přepínač.
 *        Nic se nemění, žádné tajné hodnoty se nevrací.
 * POST { action: 'create-prices', currency: 'czk'|'eur', amounts: {kine, clips, all},
 *        eur?: {kine, clips, all} }
 *      - založí u Stripe produkty a měsíční ceny tří variant (znovu nic
 *        nezdvojí - ceny mají lookup_key) a vrátí řádky do Vercelu.
 * POST { action: 'create-webhook' }
 *      - založí webhook na /api/donate/webhook se všemi událostmi a vrátí
 *        jeho podpisový klíč (Stripe ho ukáže jen teď); existující webhook
 *        jen doplní o chybějící události.
 *
 * Jen správce (is_admin). Klíč Stripe se bere z Vercelu - testovací nebo
 * ostrý, podle toho se zakládá v testovacím nebo ostrém režimu.
 */

const NO_STORE = { 'Cache-Control': 'no-store' };
const API_VERSION = '2024-06-20';

const TIER_PRODUCT: Record<PaidTier, { name: string; description: string; env: string }> = {
  kine: { name: 'Kine Plus', description: 'Odznak PLUS a 3× víc nahrávání na Kine.', env: 'KINE' },
  clips: { name: 'Klipy Plus', description: 'Automatické nahrávání klipů z appky po hře, klipy až 5 minut.', env: 'CLIPS' },
  all: { name: 'Kine Plus + Klipy', description: 'Kine Plus i Klipy Plus dohromady.', env: 'ALL' },
};

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return null;
  const { data: profile } = await supabaseServer.from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle();
  return profile?.is_admin ? userData.user.id : null;
}

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  const mode = keyMode(key);
  if (mode !== 'test' && mode !== 'live') return null;
  return new Stripe(key!.trim(), { apiVersion: API_VERSION });
}

/** Webhook Kine mezi všemi: přesná adresa a zapnutý napřed. */
function pickKineWebhook(list: Stripe.WebhookEndpoint[], siteUrl: string): Stripe.WebhookEndpoint | undefined {
  const ours = list.filter((w) => isKineWebhookUrl(w.url, siteUrl));
  const score = (w: Stripe.WebhookEndpoint) => (sameWebhookUrl(w.url, siteUrl) ? 2 : 0) + (w.status === 'enabled' ? 1 : 0);
  return ours.sort((a, b) => score(b) - score(a))[0];
}

/** Zkušební POST bez podpisu na webhook webu: 400 = odpovídá; 3xx = přesměrování (Stripe ho nenásleduje). */
async function probeWebhook(url: string): Promise<{ status: number | null; location: string | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', 'user-agent': 'Kine admin - kontrola webhooku' },
      body: '{}',
      signal: AbortSignal.timeout(6000),
    });
    return { status: res.status, location: res.headers.get('location'), error: null };
  } catch (e: any) {
    return { status: null, location: null, error: String(e?.message ?? e).slice(0, 120) };
  }
}

function priceInfo(p: Stripe.Price): PriceInfo {
  const product = typeof p.product === 'object' && p.product && !('deleted' in p.product && p.product.deleted) ? (p.product as Stripe.Product) : null;
  return {
    id: p.id,
    active: p.active,
    currency: p.currency,
    unitAmount: p.unit_amount,
    interval: p.recurring?.interval ?? null,
    intervalCount: p.recurring?.interval_count ?? null,
    productActive: product ? product.active : null,
    // currency_options Stripe posílá, jen když se o ně řekne (expand).
    currencies: [p.currency, ...Object.keys(p.currency_options ?? {}).filter((c) => c !== p.currency)],
  };
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403, headers: NO_STORE });

  const siteUrl = siteUrlFrom(req);
  const mode = keyMode(process.env.STRIPE_SECRET_KEY);
  const facts: SetupFacts = {
    keyMode: mode,
    webhookSecretSet: /^whsec_[A-Za-z0-9]+$/.test((process.env.STRIPE_WEBHOOK_SECRET ?? '').trim()),
    paymentsFlag: PAYMENTS_ENABLED,
    creatorFlag: CREATOR_PAYMENTS_ENABLED,
    operatorName: !!LEGAL_OPERATOR.name,
    operatorIco: !!LEGAL_OPERATOR.ico,
    account: null,
    accountError: null,
    payoutCurrencies: [],
    priceCurrencies: [],
    webhook: null,
    prices: {
      kine: { id: tierStripePriceId('kine'), problems: [], label: tierPriceLabel('kine') },
      clips: { id: tierStripePriceId('clips'), problems: [], label: tierPriceLabel('clips') },
      all: { id: tierStripePriceId('all'), problems: [], label: tierPriceLabel('all') },
    },
    portalDefault: null,
    storageHours: storageHoursFromEnv(process.env),
    plusMultiplier: PLUS_UPLOAD_MULTIPLIER,
  };
  const info: Record<string, unknown> = { siteUrl, webhookUrl: webhookUrlFor(siteUrl), mode, account: null, webhooks: [], prices: {} };

  const stripe = stripeClient();
  if (stripe) {
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
    const [account, endpoints, portal, failed, probe] = await Promise.all([
      stripe.accounts.retrieve().catch((e: any) => ({ error: String(e?.message ?? e) }) as const),
      stripe.webhookEndpoints.list({ limit: 100 }).catch(() => null),
      stripe.billingPortal.configurations.list({ is_default: true, limit: 1 }).catch(() => null),
      // Nedoručené události (čekají na další pokus, nebo to Stripe vzdal) - špatný podpisový klíč, přesměrování…
      stripe.events.list({ delivery_success: false, created: { gte: weekAgo }, limit: 100 }).catch(() => null),
      probeWebhook(webhookUrlFor(siteUrl)),
    ]);
    facts.probe = probe;
    if (failed) {
      const ours = failed.data.filter((ev) => (REQUIRED_WEBHOOK_EVENTS as readonly string[]).includes(ev.type));
      facts.failedDeliveries = { count: ours.length, latestType: ours[0]?.type ?? null, latestAt: ours[0]?.created ?? null };
    }
    if ('error' in account) {
      facts.accountError = account.error;
    } else {
      facts.account = { chargesEnabled: !!account.charges_enabled, payoutsEnabled: !!account.payouts_enabled, detailsSubmitted: !!account.details_submitted };
      // Měny výplat: bankovní účty (když je Stripe ukáže), jinak výchozí měna účtu.
      const banks = (account.external_accounts?.data ?? []).map((x) => (x.currency ?? '').toLowerCase()).filter(Boolean);
      facts.payoutCurrencies = Array.from(new Set(banks.length > 0 ? banks : account.default_currency ? [account.default_currency.toLowerCase()] : []));
      info.account = {
        id: account.id,
        country: account.country ?? null,
        defaultCurrency: account.default_currency ?? null,
        name: account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
        url: account.business_profile?.url ?? null,
        supportEmail: account.business_profile?.support_email ?? null,
        statementDescriptor: account.settings?.payments?.statement_descriptor ?? null,
        payoutCurrencies: facts.payoutCurrencies,
        ...facts.account,
      };
    }
    if (endpoints) {
      const best = pickKineWebhook(endpoints.data, siteUrl);
      if (best) facts.webhook = { url: best.url, status: best.status, missing: missingEvents(best.enabled_events), exact: sameWebhookUrl(best.url, siteUrl) };
      info.webhooks = endpoints.data.map((w) => ({ id: w.id, url: w.url, status: w.status, ours: isKineWebhookUrl(w.url, siteUrl), missing: missingEvents(w.enabled_events) }));
    }
    facts.portalDefault = portal ? portal.data.length > 0 : null;
    facts.portalSwitching = portal?.data[0] ? !!portal.data[0].features?.subscription_update?.enabled : null;

    const prices: Record<string, PriceInfo | null> = {};
    for (const tier of PAID_TIERS) {
      const id = facts.prices[tier].id;
      if (!id) continue;
      try {
        const p = priceInfo(await stripe.prices.retrieve(id, { expand: ['product', 'currency_options'] }));
        prices[tier] = p;
        facts.prices[tier].problems = priceProblems(p);
        facts.priceCurrencies = Array.from(new Set([...(facts.priceCurrencies ?? []), ...(p.currencies ?? [p.currency])]));
      } catch {
        prices[tier] = null;
        facts.prices[tier].problems = priceProblems(null);
      }
    }
    info.prices = prices;
  }

  return NextResponse.json({ checks: evaluateSetup(facts), info }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403, headers: NO_STORE });
  const stripe = stripeClient();
  if (!stripe) return NextResponse.json({ error: 'Ve Vercelu chybí STRIPE_SECRET_KEY (sk_test_… nebo sk_live_…) - nejdřív ho přidej a dej Redeploy.' }, { status: 400, headers: NO_STORE });

  const body = await req.json().catch(() => ({}));
  const siteUrl = siteUrlFrom(req);

  try {
    if (body?.action === 'create-prices') return NextResponse.json(await createPrices(stripe, body), { headers: NO_STORE });
    if (body?.action === 'create-webhook') return NextResponse.json(await createWebhook(stripe, siteUrl), { headers: NO_STORE });
  } catch (e: any) {
    if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: 400, headers: NO_STORE });
    return NextResponse.json({ error: `Stripe: ${e?.message ?? 'nepodařilo se'}` }, { status: 502, headers: NO_STORE });
  }
  return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400, headers: NO_STORE });
}

class InputError extends Error {}

/** Produkty a měsíční ceny tří variant. Stejná částka = použije se existující cena (lookup_key). */
async function createPrices(stripe: Stripe, body: any) {
  const currency = body?.currency === 'eur' ? 'eur' : 'czk';
  const extraCurrency = currency === 'czk' && body?.eur ? 'eur' : null;
  const out: Record<string, { id: string; label: string; reused: boolean }> = {};
  const env: string[] = [];

  for (const tier of PAID_TIERS) {
    const amount = parseAmount(body?.amounts?.[tier], currency);
    if (amount === null) throw new InputError(`Neplatná cena pro ${TIER_PRODUCT[tier].name} (${currency === 'czk' ? 'aspoň 15 Kč' : 'aspoň 0,50 €'}).`);
    const extraAmount = extraCurrency ? parseAmount(body?.eur?.[tier], extraCurrency) : null;
    if (extraCurrency && extraAmount === null) throw new InputError(`Neplatná cena v eurech pro ${TIER_PRODUCT[tier].name} (aspoň 0,50 €).`);

    const lookupKey = `kine_plus_${tier}_month_${currency}`;
    // lookup_key je u Stripe jedinečný (i u archivované ceny) - proto bez filtru na aktivní.
    const existing = (await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, expand: ['data.product', 'data.currency_options'] })).data[0];
    const existingProduct = existing && typeof existing.product === 'object' && !('deleted' in existing.product && existing.product.deleted) ? (existing.product as Stripe.Product) : null;
    const existingExtra = existing ? Object.keys(existing.currency_options ?? {}).filter((c) => c !== existing.currency) : [];
    const sameAmount =
      !!existing &&
      existing.active &&
      existingProduct?.active === true &&
      existing.unit_amount === amount &&
      existing.recurring?.interval === 'month' &&
      (existing.recurring?.interval_count ?? 1) === 1 &&
      (extraCurrency
        ? existingExtra.length === 1 && existing.currency_options?.[extraCurrency]?.unit_amount === extraAmount
        : existingExtra.length === 0);

    let price: Stripe.Price;
    if (existing && sameAmount) {
      price = existing;
    } else {
      // Produkt: stejný jako u předchozí ceny té varianty (když není archivovaný), jinak nový.
      const productId = existingProduct?.active
        ? existingProduct.id
        : (await stripe.products.create({ name: TIER_PRODUCT[tier].name, description: TIER_PRODUCT[tier].description, metadata: { kind: 'kine-plus', tier } })).id;
      price = await stripe.prices.create({
        product: productId,
        currency,
        unit_amount: amount,
        recurring: { interval: 'month' },
        lookup_key: lookupKey,
        // Nová částka přebere lookup_key starší ceny (ta zůstane pro stávající předplatitele).
        transfer_lookup_key: !!existing,
        nickname: `${TIER_PRODUCT[tier].name} - měsíčně`,
        metadata: { kind: 'kine-plus', tier },
        ...(extraCurrency && extraAmount !== null ? { currency_options: { [extraCurrency]: { unit_amount: extraAmount } } } : {}),
      });
    }
    const label = priceLabelFor({ unitAmount: amount, currency }, extraCurrency && extraAmount !== null ? { unitAmount: extraAmount, currency: extraCurrency } : null);
    out[tier] = { id: price.id, label, reused: price === existing };
    env.push(`STRIPE_PLUS_${TIER_PRODUCT[tier].env}_PRICE_ID=${price.id}`);
    env.push(`NEXT_PUBLIC_PLUS_${TIER_PRODUCT[tier].env}_PRICE_LABEL=${label}`);
  }
  return { prices: out, env };
}

/** Webhook Kine: nový (vrátí podpisový klíč), nebo doplnění událostí u existujícího. */
async function createWebhook(stripe: Stripe, siteUrl: string) {
  const url = webhookUrlFor(siteUrl);
  if (!/^https:\/\//.test(url)) throw new InputError(`Webhook musí mít adresu https (teď ${url}) - otevři tuhle stránku na ostrém webu.`);
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const existing = pickKineWebhook(endpoints.data, siteUrl);
  if (existing) {
    const missing = missingEvents(existing.enabled_events);
    // Jiná adresa (s/bez www): Stripe přesměrování nenásleduje - přepsat na adresu webu.
    const wrongUrl = !sameWebhookUrl(existing.url, siteUrl);
    if (missing.length > 0 || existing.status !== 'enabled' || wrongUrl) {
      const events = existing.enabled_events.includes('*') ? ['*'] : Array.from(new Set([...existing.enabled_events, ...REQUIRED_WEBHOOK_EVENTS]));
      await stripe.webhookEndpoints.update(existing.id, {
        enabled_events: events as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
        disabled: false,
        ...(wrongUrl ? { url } : {}),
      });
    }
    // Podpisový klíč se úpravou nemění (Stripe ho znovu nevydá) - ten ve Vercelu platí dál.
    return { created: false, updated: missing.length > 0 || existing.status !== 'enabled' || wrongUrl, url: wrongUrl ? url : existing.url, secret: null, env: [] as string[] };
  }
  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: [...REQUIRED_WEBHOOK_EVENTS],
    api_version: API_VERSION,
    description: 'Kine - platby (Kine Plus, dary, předplatné kanálů, podpory)',
  });
  return { created: true, updated: false, url: created.url, secret: created.secret ?? null, env: created.secret ? [`STRIPE_WEBHOOK_SECRET=${created.secret}`] : [] };
}
