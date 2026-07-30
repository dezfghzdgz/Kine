import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

// Zajistí, aby měl tvůrce vlastní Stripe Connect Express účet, a pošle
// ho na appky Stripem hostovanou stránku onboardingu (appka appky
// identitu, bankovní účet a appku). Appka appka appky nikdy nevidí
// citlivé bankovní údaje přímo - to celé řeší appka Stripe.
export async function POST(req: NextRequest) {
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
      });
      accountId = account.id;
      await supabaseServer.from('profiles').update({ stripe_account_id: accountId }).eq('id', userData.user.id);
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

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
    return NextResponse.json({ error: err.message ?? 'Něco se pokazilo.' }, { status: 500 });
  }
}
