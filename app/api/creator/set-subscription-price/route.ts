import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

const MIN_PRICE_EUR = 1;
const MAX_PRICE_EUR = 100;

// Založí (nebo přepíše) měsíční cenu předplatného pro daného tvůrce -
// vytvoří nový Product/Price na appky vlastním (platformovém) Stripe
// účtu. Samotná platba pak poběží přes appka "destination charge"
// (transfer_data), ne přímo na Connect účtu tvůrce.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { priceEur } = await req.json();
  const price = Number(priceEur);
  if (!price || price < MIN_PRICE_EUR || price > MAX_PRICE_EUR) {
    return NextResponse.json({ error: `Cena musí být mezi ${MIN_PRICE_EUR} a ${MAX_PRICE_EUR} EUR.` }, { status: 400 });
  }

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete, username')
    .eq('id', userData.user.id)
    .single();

  if (!profile?.stripe_onboarding_complete) {
    return NextResponse.json({ error: 'Nejdřív musíš dokončit propojení se Stripe.' }, { status: 400 });
  }

  const product = await stripeServer.products.create({
    name: `Předplatné - ${profile.username}`,
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
