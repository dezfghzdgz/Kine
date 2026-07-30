import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

// Appka si bere 15 % z každého předplatného jako provizi za appku - je
// to jen konstanta appky, appka jde kdykoliv změnit.
const PLATFORM_FEE_PERCENT = 15;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { creatorId } = await req.json();
  if (!creatorId) return NextResponse.json({ error: 'Chybí creatorId.' }, { status: 400 });
  if (creatorId === userData.user.id) return NextResponse.json({ error: 'Sám sebe si předplatit nemůžeš.' }, { status: 400 });

  const { data: creator } = await supabaseServer
    .from('profiles')
    .select('stripe_account_id, stripe_onboarding_complete, subscription_stripe_price_id, username')
    .eq('id', creatorId)
    .single();

  if (!creator?.stripe_onboarding_complete || !creator.subscription_stripe_price_id) {
    return NextResponse.json({ error: 'Tenhle tvůrce ještě předplatné nenastavil.' }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  const sessionParams: any = {
    mode: 'subscription',
    line_items: [{ price: creator.subscription_stripe_price_id, quantity: 1 }],
    subscription_data: {
      application_fee_percent: PLATFORM_FEE_PERCENT,
      transfer_data: { destination: creator.stripe_account_id },
      metadata: { subscriberId: userData.user.id, creatorId },
    },
    metadata: { subscriberId: userData.user.id, creatorId },
    success_url: `${siteUrl}/channel/${creatorId}?subscribed=1`,
    cancel_url: `${siteUrl}/channel/${creatorId}`,
  };

  const session = await stripeServer.checkout.sessions.create(sessionParams);

  return NextResponse.json({ url: session.url });
}
