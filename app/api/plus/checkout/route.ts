import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Koupě Kine Plus: založí u Stripe předplatné (Checkout) a pošle uživatele
 * na platební stránku. Cena je jedna, daná STRIPE_PLUS_PRICE_ID (Stripe
 * dashboard -> Product catalog -> Kine Plus -> Price, měsíční).
 *
 * Že platba proběhla, se dozví až webhook (app/api/donate/webhook) - ten
 * nastaví plan = plus. Stránka /plus?ok=1 je jen poděkování.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const priceId = process.env.STRIPE_PLUS_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: 'Kine Plus se teprve připravuje.', code: 'not-configured' }, { status: 503 });
  }

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('plan, plan_until, plan_stripe_customer_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const userId = userData.user.id;

  try {
    const session = await stripeServer.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Stejný zákazník u Stripe jako minule, ať se nemnoží.
      ...(profile?.plan_stripe_customer_id ? { customer: profile.plan_stripe_customer_id } : { customer_email: userData.user.email ?? undefined }),
      subscription_data: { metadata: { kind: 'kine-plus', userId } },
      metadata: { kind: 'kine-plus', userId },
      allow_promotion_codes: true,
      success_url: `${siteUrl}/plus?ok=1`,
      cancel_url: `${siteUrl}/plus`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Stripe se nepodařilo zavolat.' }, { status: 502 });
  }
}
