import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable } from '@/lib/apiUser';
import { SPECIAL_BADGES, isCustomBadgeId, isSpecialBadge, sanitizeCustom, sanitizeSpecial } from '@/lib/badges';
import { requireBadgeStaff } from '@/lib/badgeAdmin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Speciální a vlastní odznaky (tým Kine - moderátor nebo správce): kdo je má,
 * přidat / odebrat. Speciální = Majitel, Vývojář, Tým Kine, Moderátor, Beta
 * tester, Partner, Lovec chyb (lib/badges.ts); vlastní si tým vytvoří sám
 * (app/api/admin/badges/custom). Majitele přiděluje jen správce. Zapisuje jen
 * server - tabulky mají pro prohlížeč jen čtení, sám si odznak nikdo nedá.
 *
 * GET  ?search=jmeno         - uživatelé a jejich odznaky (bez hledání: kdo nějaký má)
 * POST { userId, badge, on } - přidat (on: true) / odebrat (on: false); badge = id
 *                              speciálního odznaku, nebo "custom:<id>" vlastního
 */
const notMigrated = () => NextResponse.json({ error: 'Chybí migrace supabase-migration-odznaky-vlastni.sql.', code: 'not-migrated' }, { status: 503 });

/** Definice vlastních odznaků (všechny); null = tabulka chybí. */
async function allCustom(): Promise<ReturnType<typeof sanitizeCustom> | null> {
  const { data, error } = await supabaseServer
    .from('custom_badges')
    .select('id, name, description, icon, color, image_url')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) return null;
  return sanitizeCustom(((data ?? []) as any[]).map((d) => ({ ...d, image: d.image_url ?? null })));
}

export async function GET(req: NextRequest) {
  const staff = await requireBadgeStaff(req);
  if (!staff) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const search = (req.nextUrl.searchParams.get('search') ?? '').trim().replace(/[%_,()\\*]/g, '').slice(0, 40);

  const custom = await allCustom();
  let ids: string[];
  if (search) {
    const { data, error } = await supabaseServer.from('profiles').select('id').ilike('username', `%${search}%`).order('username').limit(30);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ids = (data ?? []).map((p: any) => p.id as string);
  } else {
    // Bez hledání: kdo má nějaký speciální nebo vlastní odznak.
    const [special, own] = await Promise.all([
      supabaseServer.from('profile_special_badges').select('profile_id').limit(500),
      supabaseServer.from('profile_custom_badges').select('profile_id').limit(500),
    ]);
    if (isMissingTable(special.error) && isMissingTable(own.error)) return notMigrated();
    ids = Array.from(
      new Set([...((special.data ?? []) as any[]).map((r) => r.profile_id as string), ...((own.data ?? []) as any[]).map((r) => r.profile_id as string)])
    );
  }
  const base = { badges: SPECIAL_BADGES, custom: custom ?? [], customMissing: custom === null, canOwner: staff.admin };
  if (ids.length === 0) return NextResponse.json({ ...base, users: [] }, { headers: { 'Cache-Control': 'no-store' } });

  const [{ data: profiles }, specialRes, customRes] = await Promise.all([
    supabaseServer.from('profiles').select('id, username, display_name, avatar_url').in('id', ids),
    supabaseServer.from('profile_special_badges').select('profile_id, badge').in('profile_id', ids),
    supabaseServer.from('profile_custom_badges').select('profile_id, badge_id').in('profile_id', ids),
  ]);
  if (isMissingTable(specialRes.error) && isMissingTable(customRes.error)) return notMigrated();
  const specialBy = new Map<string, string[]>();
  for (const r of (specialRes.data ?? []) as { profile_id: string; badge: string }[]) {
    specialBy.set(r.profile_id, [...(specialBy.get(r.profile_id) ?? []), r.badge]);
  }
  const customBy = new Map<string, string[]>();
  for (const r of (customRes.data ?? []) as { profile_id: string; badge_id: string }[]) {
    customBy.set(r.profile_id, [...(customBy.get(r.profile_id) ?? []), String(r.badge_id).toLowerCase()]);
  }
  const users = ((profiles ?? []) as any[])
    .map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name ?? null,
      avatarUrl: p.avatar_url ?? null,
      special: sanitizeSpecial(specialBy.get(p.id) ?? []),
      custom: customBy.get(p.id) ?? [],
    }))
    .sort((a, b) => String(a.username).localeCompare(String(b.username)));
  return NextResponse.json({ ...base, users }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const staff = await requireBadgeStaff(req);
  if (!staff) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body?.userId ?? '');
  const badge = typeof body?.badge === 'string' ? body.badge : '';
  if (!UUID.test(userId) || (!isSpecialBadge(badge) && !isCustomBadgeId(badge)) || typeof body?.on !== 'boolean') {
    return NextResponse.json({ error: 'Chybí uživatel, odznak nebo zapnout/vypnout.' }, { status: 400 });
  }
  if (badge === 'owner' && !staff.admin) {
    return NextResponse.json({ error: 'Odznak Majitel Kine přiděluje jen správce.', code: 'owner-admin-only' }, { status: 403 });
  }

  let result;
  if (isSpecialBadge(badge)) {
    result = body.on
      ? await supabaseServer.from('profile_special_badges').upsert({ profile_id: userId, badge, granted_by: staff.id }, { onConflict: 'profile_id,badge', ignoreDuplicates: true })
      : await supabaseServer.from('profile_special_badges').delete().eq('profile_id', userId).eq('badge', badge);
  } else {
    const badgeId = badge.slice('custom:'.length).toLowerCase();
    result = body.on
      ? await supabaseServer.from('profile_custom_badges').upsert({ profile_id: userId, badge_id: badgeId, granted_by: staff.id }, { onConflict: 'profile_id,badge_id', ignoreDuplicates: true })
      : await supabaseServer.from('profile_custom_badges').delete().eq('profile_id', userId).eq('badge_id', badgeId);
  }
  if (isMissingTable(result.error)) return notMigrated();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });

  const [{ data: special }, { data: custom }] = await Promise.all([
    supabaseServer.from('profile_special_badges').select('badge').eq('profile_id', userId),
    supabaseServer.from('profile_custom_badges').select('badge_id').eq('profile_id', userId),
  ]);
  return NextResponse.json({
    ok: true,
    special: sanitizeSpecial(((special ?? []) as { badge: string }[]).map((r) => r.badge)),
    custom: ((custom ?? []) as { badge_id: string }[]).map((r) => String(r.badge_id).toLowerCase()),
  });
}
