import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';

// Zeptá se Stripe, jestli tvůrce dokončil onboarding (má vyplněné
// potřebné údaje a smí přijímat platby) a podle toho aktualizuje appku
// v databázi.
export async function POST(req: NextRequest) {
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

  if (!profile?.stripe_account_id) {
    return NextResponse.json({ complete: false });
  }

  const account = await stripeServer.accounts.retrieve(profile.stripe_account_id);
  const complete = !!(account.details_submitted && account.charges_enabled);

  await supabaseServer.from('profiles').update({ stripe_onboarding_complete: complete }).eq('id', userData.user.id);

  return NextResponse.json({ complete });
}
