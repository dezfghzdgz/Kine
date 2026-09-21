import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { hasPlus, isPaidTier, normalizePlan } from '@/lib/plus';

/**
 * Ruční správa předplatného (admin): dát někomu Kine Plus / Klipy Plus /
 * obojí na dobu určitou nebo bez konce (partneři, testeři, náhrada za
 * problém), nebo ho odebrat. Sloupce plánu jsou chráněné spouštěčem -
 * jde to jen tudy (service role).
 *
 * GET  ?search=jmeno  - uživatelé a jejich plán (bez hledání: kdo má předplatné)
 * POST { userId, plan: 'free'|'kine'|'clips'|'all', until: ISO|null, note }
 */
async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return null;
  const { data: profile } = await supabaseServer.from('profiles').select('is_admin').eq('id', userData.user.id).single();
  return profile?.is_admin ? userData.user.id : null;
}

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });

  const search = req.nextUrl.searchParams.get('search')?.trim() ?? '';
  let query = supabaseServer
    .from('profiles')
    .select('id, username, display_name, avatar_url, plan, plan_until, plan_note, plan_stripe_subscription_id')
    .order('username', { ascending: true })
    .limit(50);
  if (search) query = query.ilike('username', `%${search}%`);
  else query = query.neq('plan', 'free');

  const { data, error } = await query;
  if (error) {
    // Nejspíš neproběhla migrace supabase-migration-kine-plus.sql.
    return NextResponse.json({ error: error.message, code: 'not-configured' }, { status: 503 });
  }
  return NextResponse.json({
    users: (data ?? []).map((u: any) => ({ ...u, plan: normalizePlan(u.plan), active: hasPlus(u.plan, u.plan_until), viaStripe: Boolean(u.plan_stripe_subscription_id) })),
  });
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });

  const { userId, plan, until, note } = await req.json().catch(() => ({}));
  if (!userId || (plan !== 'free' && !isPaidTier(plan))) {
    return NextResponse.json({ error: 'Chybí userId nebo plán (free / kine / clips / all).' }, { status: 400 });
  }
  let planUntil: string | null = null;
  if (plan !== 'free' && until) {
    const date = new Date(until);
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Neplatné datum.' }, { status: 400 });
    planUntil = date.toISOString();
  }

  const { error } = await supabaseServer
    .from('profiles')
    .update({
      plan,
      plan_until: planUntil,
      plan_note: typeof note === 'string' ? note.slice(0, 300) : null,
      // Ruční nastavení přebíjí Stripe - vazba se zahodí, ať ji webhook nepřepíše.
      plan_stripe_subscription_id: null,
    })
    .eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabaseServer.from('notifications').insert({
    user_id: userId,
    message:
      plan === 'free'
        ? 'Předplatné Kine na tvém účtu skončilo.'
        : plan === 'kine'
          ? 'Máš Kine Plus.'
          : plan === 'clips'
            ? 'Máš Klipy Plus. Appka Kine do PC teď může nahrávat klipy automaticky.'
            : 'Máš Kine Plus + Klipy. Appka Kine do PC teď může nahrávat klipy automaticky.',
    link: '/plus',
  });

  return NextResponse.json({ ok: true });
}
