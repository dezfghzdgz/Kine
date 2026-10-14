import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { CUSTOM_BADGE_IMAGE_MAX_BYTES, badgeImageKind } from '@/lib/badges';
import { BADGE_IMAGE_BUCKET, BADGE_IMAGE_FOLDER, requireBadgeStaff } from '@/lib/badgeAdmin';

export const dynamic = 'force-dynamic';

/**
 * Obrázek vlastního odznaku (tým Kine): tělo = soubor PNG, JPG, GIF (i animovaný)
 * nebo WebP, nejvýš 2 MB. Druh se pozná z obsahu, ne z přípony. Uloží se do
 * veřejného úložiště Kine (thumbnails/badges/) a vrátí se adresa pro odznak.
 */
export async function POST(req: NextRequest) {
  const staff = await requireBadgeStaff(req);
  if (!staff) return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 });
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > CUSTOM_BADGE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'Obrázek je moc velký (nejvýš 2 MB).', code: 'too-big' }, { status: 413 });
  const bytes = new Uint8Array(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.length === 0) return NextResponse.json({ error: 'Chybí obrázek.' }, { status: 400 });
  if (bytes.length > CUSTOM_BADGE_IMAGE_MAX_BYTES) return NextResponse.json({ error: 'Obrázek je moc velký (nejvýš 2 MB).', code: 'too-big' }, { status: 413 });
  const kind = badgeImageKind(bytes);
  if (!kind) return NextResponse.json({ error: 'Tohle není obrázek PNG, JPG, GIF ani WebP.', code: 'not-image' }, { status: 400 });
  const path = `${BADGE_IMAGE_FOLDER}/${randomUUID()}.${kind.ext}`;
  const { error } = await supabaseServer.storage.from(BADGE_IMAGE_BUCKET).upload(path, bytes, { contentType: kind.type, cacheControl: '31536000', upsert: false });
  if (error) return NextResponse.json({ error: `Obrázek se nepodařilo uložit: ${error.message}` }, { status: 500 });
  const { data } = supabaseServer.storage.from(BADGE_IMAGE_BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
