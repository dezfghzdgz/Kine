import { NextRequest, NextResponse } from 'next/server';
import { CREATOR_PAYMENTS_ENABLED, CREATOR_PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

// Pod ~3 € by Kine na předplatném prodělalo: z 15 % provize platí poplatek Stripe za platbu
// (~1,5 % + 0,25 €) i Connect (výplaty tvůrcům) - u 1 € by z 0,15 € zbylo míň než nic.
const MIN_PRICE_EUR = 3;
const MAX_PRICE_EUR = 100;

// Založí (nebo přepíše) měsíční cenu předplatného pro daného tvůrce -
// vytvoří nový Product/Price na appky vlastním (platformovém) Stripe
// účtu. Samotná platba pak poběží přes appka "destination charge"
// (transfer_data), ne přímo na Connect účtu tvůrce.
export async function POST(req: NextRequest) {
  // Peníze pro tvůrce zatím neběží (lib/payments.ts, NEXT_PUBLIC_CREATOR_PAYMENTS) - nic se nezaplatí ani omylem.
  if (!CREATOR_PAYMENTS_ENABLED) return NextResponse.json(CREATOR_PAYMENTS_OFF, { status: 503 });
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  // Každé uložení zakládá objekty u Stripe - nejvýš párkrát za 10 minut.
  if (!allowRequest(`set-subscription-price:${userData.user.id}`, 5, 10 * 60 * 1000)) return tooManyRequests(60);

  const body = await req.json().catch(() => null);
  const price = Math.round(Number(body?.priceEur) * 100) / 100;
  if (!Number.isFinite(price) || price < MIN_PRICE_EUR || price > MAX_PRICE_EUR) {
    return NextResponse.json({ error: `Cena musí být mezi ${MIN_PRICE_EUR} a ${MAX_PRICE_EUR} EUR.`, code: 'price', min: MIN_PRICE_EUR, max: MAX_PRICE_EUR }, { status: 400 });
  }

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete, username, subscription_price_eur, subscription_stripe_price_id')
    .eq('id', userData.user.id)
    .single();

  if (!profile?.stripe_onboarding_complete) {
    return NextResponse.json({ error: 'Nejdřív musíš dokončit propojení se Stripe.' }, { status: 400 });
  }

  // Stejná cena znovu - nic nového u Stripe nezakládat.
  if (profile.subscription_stripe_price_id && Number(profile.subscription_price_eur) === price) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // Produkt kanálu se používá dál (nová cena k němu); dřív každé uložení
  // založilo u Stripe nový produkt. Stará cena se vypne - stávající
  // předplatitelé na ní běží dál, noví platí novou.
  const oldPriceId: string | null = profile.subscription_stripe_price_id ?? null;
  let productId: string | null = null;
  if (oldPriceId) {
    try {
      const old = await stripeServer.prices.retrieve(oldPriceId);
      productId = typeof old.product === 'string' ? old.product : old.product?.id ?? null;
    } catch {
      productId = null;
    }
  }
  if (!productId) {
    // Název vidí předplatitel na platební stránce a ve správě předplatného - anglicky (základní jazyk Kine).
    const product = await stripeServer.products.create({
      name: `Channel membership - ${profile.username} on Kine`,
      metadata: { kind: 'creator-subscription', creatorId: userData.user.id },
    });
    productId = product.id;
  }

  const stripePrice = await stripeServer.prices.create({
    product: productId,
    currency: 'eur',
    unit_amount: Math.round(price * 100),
    recurring: { interval: 'month' },
    metadata: { kind: 'creator-subscription', creatorId: userData.user.id },
  });

  await supabaseServer
    .from('profiles')
    .update({ subscription_price_eur: price, subscription_stripe_price_id: stripePrice.id })
    .eq('id', userData.user.id);

  if (oldPriceId && oldPriceId !== stripePrice.id) {
    await stripeServer.prices.update(oldPriceId, { active: false }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
