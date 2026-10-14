import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable } from '@/lib/apiUser';
import { customBadgeInput, sanitizeCustom } from '@/lib/badges';
import { BADGE_IMAGE_BUCKET, badgeImageBase, badgeImagePath, requireBadgeStaff } from '@/lib/badgeAdmin';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notMigrated = () => NextResponse.json({ error: 'Vlastní odznaky potřebují migraci supabase-migration-odznaky-vlastni.sql.', code: 'not-migrated' }, { status: 503 });

function asDef(row: any) {
  return sanitizeCustom([{ ...row, image: row?.image_url ?? null }])[0] ?? null;
}

/** Smaže obrázek odznaku z úložiště (jen obrázky odznaků Kine); chyby nevadí. */
async function removeImage(url: string | null | undefined): Promise<void> {
  const path = badgeImagePath(url);
  if (path) await supabaseServer.storage.from(BADGE_IMAGE_BUCKET).remove([path]).then(() => undefined, () => undefined);
}

/**
 * Vlastní odznaky (tým Kine - moderátor nebo správce):
 * POST   { name, description, icon, color, image } - nový
 * PATCH  { id, ...co se mění }                     - úprava
 * DELETE ?id=                                      - smazat (zmizí i všem, kdo ho mají)
 * Obrázek se nahraje zvlášť (app/api/admin/badges/image) a sem přijde jeho adresa.
 */
export async function POST(req: NextRequest) {
  const staff = await requireBadgeStaff(req);
  if (!staff) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const parsed = customBadgeInput(await req.json().catch(() => ({})), { imageBase: badgeImageBase() });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const { data, error } = await supabaseServer
    .from('custom_badges')
    .insert({ name: v.name, description: v.description ?? null, icon: v.icon, color: v.color, image_url: v.image ?? null, created_by: staff.id })
    .select('id, name, description, icon, color, image_url')
    .single();
  if (isMissingTable(error)) return notMigrated();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ badge: asDef(data) });
}

export async function PATCH(req: NextRequest) {
  const staff = await requireBadgeStaff(req);
  if (!staff) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? '');
  if (!UUID.test(id)) return NextResponse.json({ error: 'Chybí, který odznak upravit.' }, { status: 400 });
  const parsed = customBadgeInput(body, { partial: true, imageBase: badgeImageBase() });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const { data: before, error: readError } = await supabaseServer.from('custom_badges').select('image_url').eq('id', id).maybeSingle();
  if (isMissingTable(readError)) return notMigrated();
  if (!before) return NextResponse.json({ error: 'Odznak nenalezen.' }, { status: 404 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (v.name !== undefined) patch.name = v.name;
  if (v.description !== undefined) patch.description = v.description;
  if (v.icon !== undefined) patch.icon = v.icon;
  if (v.color !== undefined) patch.color = v.color;
  if (v.image !== undefined) patch.image_url = v.image;
  const { data, error } = await supabaseServer.from('custom_badges').update(patch).eq('id', id).select('id, name, description, icon, color, image_url').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // Starý obrázek, který odznak už nepoužívá, pryč z úložiště.
  if (v.image !== undefined && (before as any).image_url && (before as any).image_url !== v.image) await removeImage((before as any).image_url);
  return NextResponse.json({ badge: asDef(data) });
}

export async function DELETE(req: NextRequest) {
  const staff = await requireBadgeStaff(req);
  if (!staff) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!UUID.test(id)) return NextResponse.json({ error: 'Chybí, který odznak smazat.' }, { status: 400 });
  const { data, error } = await supabaseServer.from('custom_badges').delete().eq('id', id).select('image_url');
  if (isMissingTable(error)) return notMigrated();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  for (const row of (data ?? []) as { image_url: string | null }[]) await removeImage(row.image_url);
  return NextResponse.json({ ok: true, deleted: (data ?? []).length });
}
