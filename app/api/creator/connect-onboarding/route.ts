import { NextRequest, NextResponse } from 'next/server';
import { publicError } from '@/lib/paymentsServer';
import { CREATOR_PAYMENTS_ENABLED, CREATOR_PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { siteUrlFrom } from '@/lib/siteUrl';

// Zajistí, aby měl tvůrce vlastní Stripe Connect Express účet, a pošle
// ho na stránku onboardingu hostovanou Stripem (ověří si identitu,
// bankovní účet a doklady). Naše appka tyhle údaje nikdy nevidí
// citlivé bankovní údaje přímo - to celé řeší appka Stripe.
export async function POST(req: NextRequest) {
  // Peníze pro tvůrce zatím neběží (lib/payments.ts, NEXT_PUBLIC_CREATOR_PAYMENTS) - nic se nezaplatí ani omylem.
  if (!CREATOR_PAYMENTS_ENABLED) return NextResponse.json(CREATOR_PAYMENTS_OFF, { status: 503 });
  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

    const { data: userData } = await supabaseServer.auth.getUser(token);
    if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

    const { data: profile } = await supabaseServer
      .from('profiles')
      .select('stripe_account_id')
      .eq('id', userData.user.id)
      .single();

    let accountId = profile?.stripe_account_id;

    if (!accountId) {
      const account = await stripeServer.accounts.create({
        type: 'express',
        email: userData.user.email,
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        // Výplaty tvůrci jednou za měsíc (1. den): Stripe Connect účtuje Kine poplatek za každý
        // měsíc s výplatou a za každou výplatu - po kouskách každý den by to sežralo provizi.
        settings: { payouts: { schedule: { interval: 'monthly', monthly_anchor: 1 } } },
      // Dvojklik / dvě okna: jeden účet u Stripe, ne dva (Stripe vrátí ten samý).
      }, { idempotencyKey: `kine-connect-${userData.user.id}` });
      accountId = account.id;
      await supabaseServer.from('profiles').update({ stripe_account_id: accountId }).eq('id', userData.user.id);
    }

    const siteUrl = siteUrlFrom(req);

    const accountLink = await stripeServer.accountLinks.create({
      account: accountId,
      refresh_url: `${siteUrl}/settings?stripe_refresh=1`,
      return_url: `${siteUrl}/settings?stripe_return=1`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: accountLink.url });
  } catch (err: any) {
    // Appka teď vrátí konkrétní chybu ze Stripe (třeba "Connect ještě
    // není na tvém účtu zapnutý"), místo aby appka spadla bez odpovědi -
    // přesně tohle způsobovalo to "Processing..." navždy.
    return NextResponse.json({ error: publicError(err, 'Něco se pokazilo.', 'Kine Connect') }, { status: 500 });
  }
}
