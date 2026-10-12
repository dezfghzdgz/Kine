import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { tipFeePercent, TIP_LIMITS } from '@/lib/liveTips';
import { tipTarget } from '@/lib/liveTipsServer';

export const dynamic = 'force-dynamic';

/**
 * Podpory ve studiu (/live): GET = jestli je kanál přijímá (a proč ne),
 * posledních 50 zaplacených a součty; PATCH { enabled } = zapnout / vypnout.
 */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const target = await tipTarget(user.id);
  const { data, error } = await supabaseServer
    .from('live_tips')
    .select('id, user_id, amount_cents, currency, fee_cents, message, paid_at, created_at')
    .eq('channel_id', user.id)
    .eq('status', 'paid')
    .order('paid_at', { ascending: false })
    .limit(50);
  if (isMissingTable(error)) return NextResponse.json({ available: false, enabled: false, reason: 'unavailable', tips: [] });

  const rows = (data ?? []) as any[];
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  const { data: people } = ids.length ? await supabaseServer.from('profiles').select('id, username, display_name').in('id', ids) : { data: [] as any[] };
  const names = new Map<string, string>((people ?? []).map((p: any) => [p.id, p.display_name || p.username]));
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const totals: Record<string, { day: number; all: number }> = {};
  for (const r of rows) {
    const share = r.amount_cents - (r.fee_cents ?? 0);
    totals[r.currency] ??= { day: 0, all: 0 };
    totals[r.currency].all += share;
    if (new Date(r.paid_at ?? r.created_at).getTime() >= dayAgo) totals[r.currency].day += share;
  }
  return NextResponse.json(
    {
      available: true,
      enabled: target.ok,
      reason: target.ok ? null : target.reason,
      feePercent: tipFeePercent(process.env.LIVE_TIP_FEE_PERCENT),
      limits: TIP_LIMITS,
      totals,
      tips: rows.map((r) => ({
        id: r.id,
        name: r.user_id ? names.get(r.user_id) ?? '—' : '—',
        amountCents: r.amount_cents,
        shareCents: r.amount_cents - (r.fee_cents ?? 0),
        currency: r.currency,
        message: r.message,
        at: r.paid_at ?? r.created_at,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function PATCH(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body?.enabled !== 'boolean') return NextResponse.json({ error: 'Chybí enabled.' }, { status: 400 });
  const { error } = await supabaseServer.from('profiles').update({ live_tips_enabled: body.enabled }).eq('id', user.id);
  if (error) {
    const missing = /live_tips_enabled/.test(error.message ?? '');
    return NextResponse.json({ error: missing ? 'Podpory potřebují migraci supabase-migration-podpory-kontrola.sql.' : error.message }, { status: missing ? 503 : 500 });
  }
  const target = await tipTarget(user.id);
  return NextResponse.json({ ok: true, enabled: target.ok, reason: target.ok ? null : target.reason });
}
