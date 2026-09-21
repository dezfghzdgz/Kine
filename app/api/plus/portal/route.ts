import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Správa předplatného Kine Plus (zrušení, změna karty) - zákaznický
 * portál Stripe. V dashboardu Stripe musí být portál jednou zapnutý
 * (Settings -> Billing -> Customer portal), jinak Stripe vrátí chybu.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('plan_stripe_customer_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile?.plan_stripe_customer_id) {
    return NextResponse.json({ error: 'K tomuhle účtu není u Stripe žádné předplatné (Plus máš nastavené ručně).', code: 'no-customer' }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  try {
    const session = await stripeServer.billingPortal.sessions.create({
      customer: profile.plan_stripe_customer_id,
      return_url: `${siteUrl}/plus`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Stripe se nepodařilo zavolat.' }, { status: 502 });
  }
}
