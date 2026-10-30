import { NextRequest, NextResponse } from 'next/server';
import { CREATOR_PAYMENTS_ENABLED, CREATOR_PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

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

  const { priceEur } = await req.json();
  const price = Number(priceEur);
  if (!price || price < MIN_PRICE_EUR || price > MAX_PRICE_EUR) {
    return NextResponse.json({ error: `Cena musí být mezi ${MIN_PRICE_EUR} a ${MAX_PRICE_EUR} EUR.`, code: 'price', min: MIN_PRICE_EUR, max: MAX_PRICE_EUR }, { status: 400 });
  }

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete, username')
    .eq('id', userData.user.id)
    .single();

  if (!profile?.stripe_onboarding_complete) {
    return NextResponse.json({ error: 'Nejdřív musíš dokončit propojení se Stripe.' }, { status: 400 });
  }

  // Název vidí předplatitel na platební stránce a ve správě předplatného - anglicky (základní jazyk Kine).
  const product = await stripeServer.products.create({
    name: `Channel membership - ${profile.username} on Kine`,
    metadata: { kind: 'creator-subscription', creatorId: userData.user.id },
  });

  const stripePrice = await stripeServer.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: Math.round(price * 100),
    recurring: { interval: 'month' },
  });

  await supabaseServer
    .from('profiles')
    .update({ subscription_price_eur: price, subscription_stripe_price_id: stripePrice.id })
    .eq('id', userData.user.id);

  return NextResponse.json({ ok: true });
}
