import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabaseServer';
import { isAdminUser, isMissingTable, userFromRequest } from '@/lib/apiUser';
import { campaignDay, cleanDay, normalizeHandle, parseHandles } from '@/lib/fans';
import { firstFanAt, loadFanWall } from '@/lib/fansServer';

export const dynamic = 'force-dynamic';

/**
 * Podporovatelé - správa (jen správce Kine, stránka /admin/supporters).
 *
 * GET                                        seznam jmen, nastavení, číslo dnešního dne kampaně
 * POST { action: 'add', handles, day? }      přidat jedno nebo víc jmen (řádky / čárky); day = číslo dne, jinak dnešní
 * POST { action: 'remove', id }              smazat jméno (kdo tam být nechce)
 * POST { action: 'link', id, username }      propojit s účtem na Kine (odkaz na kanál + odznak Zakladatel)
 * POST { action: 'unlink', id }              zrušit propojení
 * POST { action: 'settings', instagram }     účet Kine na Instagramu (tlačítko "Sledovat" na stránce)
 *
 * Tabulky jsou jen pro server (supabase-migration-fans.sql). Po každé změně
 * se stránka /supporters hned obnoví (revalidatePath) - jméno je vidět okamžitě.
 */
const NOT_MIGRATED = { error: 'Chybí migrace supabase-migration-fans.sql (Supabase -> SQL Editor).', code: 'not-migrated' };
const FOUNDER = 'founder';

async function requireAdmin(req: NextRequest): Promise<{ id: string } | null> {
  const user = await userFromRequest(req);
  if (!user || !(await isAdminUser(user.id))) return null;
  return user;
}

function refreshWall() {
  try {
    revalidatePath('/supporters');
  } catch {
    // Mimo běžící server (testy) - nic.
  }
}

/** Uživatelské jméno pro hledání v profilech: bez @, jen povolené znaky; % a _ v ilike escapované. */
function usernamePattern(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.trim().replace(/^@+/, '');
  if (!/^[A-Za-z0-9._]{2,30}$/.test(clean)) return null;
  return clean.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Odznak Zakladatel: přidat, nebo odebrat (jen když profil už nemá jiné propojené jméno). false = nešlo (migrace). */
async function setFounder(profileId: string, on: boolean, adminId: string): Promise<boolean> {
  if (on) {
    const { error } = await supabaseServer
      .from('profile_special_badges')
      .upsert({ profile_id: profileId, badge: FOUNDER, granted_by: adminId }, { onConflict: 'profile_id,badge', ignoreDuplicates: true });
    return !error;
  }
  const { count } = await supabaseServer.from('fan_wall').select('id', { count: 'exact', head: true }).eq('profile_id', profileId);
  if ((count ?? 0) > 0) return true;
  const { error } = await supabaseServer.from('profile_special_badges').delete().eq('profile_id', profileId).eq('badge', FOUNDER);
  return !error;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: 'Jen pro správce.' }, { status: 403 });
  const wall = await loadFanWall();
  if (!wall.available) return NextResponse.json(NOT_MIGRATED, { status: 503 });
  const today = campaignDay(await firstFanAt(), Date.now());
  return NextResponse.json({ ...wall, today }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Jen pro správce.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === 'add') {
    const { valid, invalid } = parseHandles(body?.handles);
    if (valid.length === 0) return NextResponse.json({ error: 'Žádná platná přezdívka (písmena, číslice, tečka, podtržítko, max 30 znaků).', invalid }, { status: 400 });
    const day = cleanDay(body?.day) ?? campaignDay(await firstFanAt(), Date.now());
    const rows = valid.map((handle) => ({ platform: 'instagram', handle, day, added_by: admin.id }));
    const { data, error } = await supabaseServer
      .from('fan_wall')
      .upsert(rows, { onConflict: 'platform,handle', ignoreDuplicates: true })
      .select('handle');
    if (error) return isMissingTable(error) ? NextResponse.json(NOT_MIGRATED, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
    const added = ((data ?? []) as { handle: string }[]).map((r) => r.handle);
    const addedSet = new Set(added);
    refreshWall();
    return NextResponse.json({ added, duplicates: valid.filter((h) => !addedSet.has(h)), invalid, day });
  }

  const id = Number(body?.id);
  if ((action === 'remove' || action === 'link' || action === 'unlink') && (!Number.isInteger(id) || id <= 0)) {
    return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  }

  if (action === 'remove') {
    const { data: row, error } = await supabaseServer.from('fan_wall').select('id, profile_id').eq('id', id).maybeSingle();
    if (error) return isMissingTable(error) ? NextResponse.json(NOT_MIGRATED, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
    if (!row) return NextResponse.json({ ok: true });
    const { error: delError } = await supabaseServer.from('fan_wall').delete().eq('id', id);
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
    if (row.profile_id) await setFounder(row.profile_id as string, false, admin.id);
    refreshWall();
    return NextResponse.json({ ok: true });
  }

  if (action === 'link') {
    const pattern = usernamePattern(body?.username);
    if (!pattern) return NextResponse.json({ error: 'Napiš uživatelské jméno na Kine.' }, { status: 400 });
    const { data: profile } = await supabaseServer.from('profiles').select('id, username').ilike('username', pattern).limit(1).maybeSingle();
    if (!profile) return NextResponse.json({ error: 'Účet s tímhle jménem na Kine není.' }, { status: 404 });
    const { data: before } = await supabaseServer.from('fan_wall').select('profile_id').eq('id', id).maybeSingle();
    const { error } = await supabaseServer.from('fan_wall').update({ profile_id: profile.id }).eq('id', id);
    if (error) return isMissingTable(error) ? NextResponse.json(NOT_MIGRATED, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
    const previous = (before as { profile_id?: string | null } | null)?.profile_id ?? null;
    if (previous && previous !== profile.id) await setFounder(previous, false, admin.id);
    const badge = await setFounder(profile.id as string, true, admin.id);
    refreshWall();
    return NextResponse.json({ ok: true, kine: { id: profile.id, username: profile.username }, badge });
  }

  if (action === 'unlink') {
    const { data: row } = await supabaseServer.from('fan_wall').select('profile_id').eq('id', id).maybeSingle();
    const { error } = await supabaseServer.from('fan_wall').update({ profile_id: null }).eq('id', id);
    if (error) return isMissingTable(error) ? NextResponse.json(NOT_MIGRATED, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
    const previous = (row as { profile_id?: string | null } | null)?.profile_id ?? null;
    if (previous) await setFounder(previous, false, admin.id);
    refreshWall();
    return NextResponse.json({ ok: true });
  }

  if (action === 'settings') {
    const raw = typeof body?.instagram === 'string' ? body.instagram : '';
    const instagram = raw.trim() === '' ? null : normalizeHandle(raw);
    if (raw.trim() !== '' && !instagram) return NextResponse.json({ error: 'Napiš @jméno nebo odkaz na profil na Instagramu.' }, { status: 400 });
    const { error } = await supabaseServer.from('fan_wall_settings').upsert({ id: 1, instagram, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return isMissingTable(error) ? NextResponse.json(NOT_MIGRATED, { status: 503 }) : NextResponse.json({ error: error.message }, { status: 500 });
    refreshWall();
    return NextResponse.json({ ok: true, instagram });
  }

  return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400 });
}
