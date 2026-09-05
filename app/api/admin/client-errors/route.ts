import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { groupErrors, type ErrorRow } from '@/lib/errorGroups';

/**
 * Přehled chyb z prohlížeče pro /admin/errors.
 *
 * Tabulka client_errors má RLS bez pravidel - z prohlížeče ji nepřečte
 * nikdo. Čte se tady, se service role, a jen když je volající admin
 * (stejná kontrola jako u podílu z výdělků).
 *
 * GET ?days=7   - skupiny chyb za posledních N dní (1-30), nejčastější napřed
 * DELETE ?fingerprint=... - smaže jednu skupinu ("vyřešeno")
 * DELETE ?olderThanDays=30 - úklid starých
 */

async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return null;

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .single();

  return profile?.is_admin ? userData.user.id : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });

  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? 7) || 7));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // Nejvýš 2000 nejnovějších řádků - přehled je o skupinách, ne o každém
  // řádku; kdyby jich bylo víc, stejně by se četly ty nejnovější.
  const { data, error } = await supabaseServer
    .from('client_errors')
    .select('id, created_at, kind, message, stack, url, user_agent, device, fingerprint')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as ErrorRow[];
  return NextResponse.json({
    days,
    total: rows.length,
    truncated: rows.length >= 2000,
    groups: groupErrors(rows),
  });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });

  const fingerprint = req.nextUrl.searchParams.get('fingerprint');
  const olderThanDays = Number(req.nextUrl.searchParams.get('olderThanDays'));

  if (fingerprint) {
    const { error } = await supabaseServer.from('client_errors').delete().eq('fingerprint', fingerprint);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (Number.isFinite(olderThanDays) && olderThanDays >= 1) {
    const before = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    const { error } = await supabaseServer.from('client_errors').delete().lt('created_at', before);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Chybí fingerprint nebo olderThanDays.' }, { status: 400 });
}
