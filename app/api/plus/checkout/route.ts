import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { hasPlus, isPaidTier, tierStripePriceId } from '@/lib/plus';
import { siteUrlFrom } from '@/lib/siteUrl';

/**
 * Koupě předplatného: založí u Stripe předplatné (Checkout) a pošle
 * uživatele na platební stránku. Tři varianty (lib/plus.ts), každá má
 * vlastní cenu ve Stripe: STRIPE_PLUS_KINE_PRICE_ID, STRIPE_PLUS_CLIPS_PRICE_ID,
 * STRIPE_PLUS_ALL_PRICE_ID (Stripe dashboard -> Product catalog -> cena, měsíční).
 *
 * Tělo: { tier: 'kine' | 'clips' | 'all' }
 *
 * Kdo už předplatné má, mění ho ve správě předplatného (portál Stripe) -
 * druhé předplatné se mu nezaloží.
 *
 * Že platba proběhla, se dozví až webhook (app/api/donate/webhook) - ten
 * nastaví plan. Stránka /plus?ok=1 je jen poděkování.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const tier = isPaidTier(body?.tier) ? body.tier : 'all';
  const priceId = tierStripePriceId(tier);
  if (!priceId) {
    return NextResponse.json({ error: 'Tahle varianta předplatného se teprve připravuje.', code: 'not-configured' }, { status: 503 });
  }

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('plan, plan_until, plan_stripe_customer_id, plan_stripe_subscription_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profile?.plan_stripe_subscription_id && hasPlus(profile.plan, profile.plan_until)) {
    return NextResponse.json({ error: 'Předplatné už máš - změnit ho jde ve správě předplatného.', code: 'already-subscribed' }, { status: 409 });
  }

  const siteUrl = siteUrlFrom(req);
  const userId = userData.user.id;

  try {
    const session = await stripeServer.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Stejný zákazník u Stripe jako minule, ať se nemnoží.
      ...(profile?.plan_stripe_customer_id ? { customer: profile.plan_stripe_customer_id } : { customer_email: userData.user.email ?? undefined }),
      subscription_data: { metadata: { kind: 'kine-plus', userId, tier } },
      metadata: { kind: 'kine-plus', userId, tier },
      allow_promotion_codes: true,
      success_url: `${siteUrl}/plus?ok=1`,
      cancel_url: `${siteUrl}/plus`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Stripe se nepodařilo zavolat.' }, { status: 502 });
  }
}
