import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable } from '@/lib/apiUser';
import { SPECIAL_BADGES, isSpecialBadge, sanitizeSpecial } from '@/lib/badges';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Speciální odznaky (správce): kdo je má, přidat / odebrat (Majitel, Vývojář,
 * Tým Kine, Moderátor, Beta tester, Partner, Lovec chyb - lib/badges.ts).
 * Zapisuje jen server - tabulka profile_special_badges má pro prohlížeč jen
 * čtení, sám si odznak nikdo nedá.
 *
 * GET  ?search=jmeno         - uživatelé a jejich speciální odznaky (bez hledání: kdo nějaký má)
 * POST { userId, badge, on } - přidat (on: true) / odebrat (on: false)
 */
async function requireAdmin(req: NextRequest): Promise<string | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;
  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return null;
  const { data: profile } = await supabaseServer.from('profiles').select('is_admin, role').eq('id', userData.user.id).maybeSingle();
  return profile?.is_admin || profile?.role === 'admin' ? userData.user.id : null;
}

const notMigrated = () => NextResponse.json({ error: 'Chybí migrace supabase-migration-zive-odznaky.sql.', code: 'not-migrated' }, { status: 503 });

export async function GET(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const search = (req.nextUrl.searchParams.get('search') ?? '').trim().replace(/[%_,()\\*]/g, '').slice(0, 40);

  let ids: string[];
  if (search) {
    const { data, error } = await supabaseServer.from('profiles').select('id').ilike('username', `%${search}%`).order('username').limit(30);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ids = (data ?? []).map((p: any) => p.id as string);
  } else {
    const { data, error } = await supabaseServer.from('profile_special_badges').select('profile_id').limit(500);
    if (isMissingTable(error)) return notMigrated();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ids = Array.from(new Set((data ?? []).map((r: any) => r.profile_id as string)));
  }
  if (ids.length === 0) return NextResponse.json({ badges: SPECIAL_BADGES, users: [] });

  const [{ data: profiles }, badgeRes] = await Promise.all([
    supabaseServer.from('profiles').select('id, username, display_name, avatar_url').in('id', ids),
    supabaseServer.from('profile_special_badges').select('profile_id, badge').in('profile_id', ids),
  ]);
  if (isMissingTable(badgeRes.error)) return notMigrated();
  const byUser = new Map<string, string[]>();
  for (const r of (badgeRes.data ?? []) as { profile_id: string; badge: string }[]) {
    byUser.set(r.profile_id, [...(byUser.get(r.profile_id) ?? []), r.badge]);
  }
  const users = ((profiles ?? []) as any[])
    .map((p) => ({ id: p.id, username: p.username, displayName: p.display_name ?? null, avatarUrl: p.avatar_url ?? null, special: sanitizeSpecial(byUser.get(p.id) ?? []) }))
    .sort((a, b) => String(a.username).localeCompare(String(b.username)));
  return NextResponse.json({ badges: SPECIAL_BADGES, users }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const adminId = await requireAdmin(req);
  if (!adminId) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId ?? '');
  const badge = body?.badge;
  if (!UUID.test(userId) || !isSpecialBadge(badge) || typeof body?.on !== 'boolean') {
    return NextResponse.json({ error: 'Chybí uživatel, odznak nebo zapnout/vypnout.' }, { status: 400 });
  }
  const result = body.on
    ? await supabaseServer.from('profile_special_badges').upsert({ profile_id: userId, badge, granted_by: adminId }, { onConflict: 'profile_id,badge', ignoreDuplicates: true })
    : await supabaseServer.from('profile_special_badges').delete().eq('profile_id', userId).eq('badge', badge);
  if (isMissingTable(result.error)) return notMigrated();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  const { data } = await supabaseServer.from('profile_special_badges').select('badge').eq('profile_id', userId);
  return NextResponse.json({ ok: true, special: sanitizeSpecial(((data ?? []) as { badge: string }[]).map((r) => r.badge)) });
}
