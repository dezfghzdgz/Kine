import { NextRequest, NextResponse } from 'next/server';
import { CREATOR_PAYMENTS_ENABLED, CREATOR_PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { siteUrlFrom } from '@/lib/siteUrl';
import { paymentAllowedNow, TEST_MODE_OFF } from '@/lib/paymentsServer';

// Appka si bere 15 % z každého předplatného jako provizi za appku - je
// to jen konstanta appky, appka jde kdykoliv změnit.
const PLATFORM_FEE_PERCENT = 15;

export async function POST(req: NextRequest) {
  // Peníze pro tvůrce zatím neběží (lib/payments.ts, NEXT_PUBLIC_CREATOR_PAYMENTS) - nic se nezaplatí ani omylem.
  if (!CREATOR_PAYMENTS_ENABLED) return NextResponse.json(CREATOR_PAYMENTS_OFF, { status: 503 });
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  // Testovací klíč Stripe: zkouší jen správce (lib/paymentsServer.ts).
  if (!(await paymentAllowedNow(userData.user.id))) return NextResponse.json(TEST_MODE_OFF, { status: 503 });

  const body = await req.json().catch(() => ({}));
  // Id tvůrce jen jako UUID malými písmeny - jinak by „ABC…“ obešlo kontrolu „sám sebe“.
  const creatorId = typeof body?.creatorId === 'string' ? body.creatorId.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(creatorId)) {
    return NextResponse.json({ error: 'Chybí creatorId.' }, { status: 400 });
  }
  if (creatorId === userData.user.id) return NextResponse.json({ error: 'Sám sebe si předplatit nemůžeš.' }, { status: 400 });

  // select('*') - payouts_suspended a is_banned jsou až s migrací moderátorských rolí.
  const { data: creatorRow } = await supabaseServer.from('profiles').select('*').eq('id', creatorId).single();
  const creator = creatorRow as {
    stripe_account_id?: string | null;
    stripe_onboarding_complete?: boolean | null;
    subscription_stripe_price_id?: string | null;
    username?: string | null;
    payouts_suspended?: boolean | null;
    is_banned?: boolean | null;
  } | null;

  if (!creator?.stripe_onboarding_complete || !creator.subscription_stripe_price_id || !creator.stripe_account_id) {
    return NextResponse.json({ error: 'Tenhle tvůrce ještě předplatné nenastavil.' }, { status: 400 });
  }
  // Moderátor tvůrci pozastavil výdělky (sankce) nebo účet zablokoval - nové předplatné nejde.
  if (creator.payouts_suspended === true || creator.is_banned === true) {
    return NextResponse.json({ error: 'Tenhle tvůrce teď předplatné nepřijímá.', code: 'disabled' }, { status: 400 });
  }

  // Druhé souběžné členství u téhož tvůrce by se platilo dvakrát (a to první by
  // přestalo být vidět) - kdo už členem je, další nekupuje.
  const { data: existing } = await supabaseServer
    .from('channel_subscriptions')
    .select('status')
    .eq('subscriber_id', userData.user.id)
    .eq('creator_id', creatorId)
    .maybeSingle();
  const existingStatus = (existing as { status?: string } | null)?.status;
  if (existingStatus === 'active' || existingStatus === 'past_due') {
    return NextResponse.json({ error: 'Členem už jsi.', code: 'already-member' }, { status: 409 });
  }

  const siteUrl = siteUrlFrom(req);

  const sessionParams: any = {
    mode: 'subscription',
    line_items: [{ price: creator.subscription_stripe_price_id, quantity: 1 }],
    // Managed Payments (zapnuté na účtu jako výchozí) nepodporují peníze pro tvůrce (Connect).
    managed_payments: { enabled: false },
    subscription_data: {
      application_fee_percent: PLATFORM_FEE_PERCENT,
      transfer_data: { destination: creator.stripe_account_id },
      metadata: { subscriberId: userData.user.id, creatorId },
    },
    metadata: { subscriberId: userData.user.id, creatorId },
    success_url: `${siteUrl}/channel/${creatorId}?subscribed=1`,
    cancel_url: `${siteUrl}/channel/${creatorId}`,
  };

  try {
    const session = await stripeServer.checkout.sessions.create(sessionParams);
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error('Kine: předplatné kanálu - Stripe:', e?.message ?? e);
    return NextResponse.json({ error: 'Platbu se nepodařilo připravit. Zkus to za chvíli znovu.' }, { status: 502 });
  }
}
