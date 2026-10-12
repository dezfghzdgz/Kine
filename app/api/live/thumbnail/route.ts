import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { checkLiveThumbnail, liveThumbnailPath, newLiveThumbnailPath, LIVE_THUMBNAIL_MAX_BYTES } from '@/lib/liveThumbnail';
import { runInBackground } from '@/lib/background';

export const dynamic = 'force-dynamic';
// Na pozadí běží kontrola obsahu náhledu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

const BUCKET = 'thumbnails';

/** Jeden kanál nejvýš jedno nahrání za tolik (na instanci serveru). */
const UPLOAD_EVERY_MS = 5 * 1000;
const lastUpload = new Map<string, number>();

function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  return !!error && (error.code === '42703' || /thumbnail_url/i.test(error.message ?? ''));
}

const NEEDS_MIGRATION = 'Vlastní náhled potřebuje migraci supabase-migration-zive-3.sql.';

/**
 * Přečte obrázek stejný dekodér, jakým ho pak projde kontrola obsahu
 * (lib/nudityScan.ts)? Obrázek, který by kontrola nepřečetla, by zůstal
 * viset neprověřený - takový se rovnou odmítne.
 */
async function decodable(bytes: Uint8Array): Promise<boolean> {
  try {
    const jpeg = (await import('jpeg-js')).default;
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 }) as { width: number; height: number };
    return image.width > 0 && image.height > 0;
  } catch {
    return false;
  }
}

/** Smaže soubor náhledu z úložiště (jen náhled přenosu toho kanálu); chyby nevadí. */
async function removeFile(url: unknown, ownerId: string): Promise<void> {
  const path = liveThumbnailPath(typeof url === 'string' ? url : null, ownerId);
  if (path) await supabaseServer.storage.from(BUCKET).remove([path]).then(() => undefined, () => undefined);
}

/**
 * Vlastní náhled přenosu: POST s obrázkem JPEG v těle (studio a appka ho
 * předem zmenší na 1280×720), DELETE ho smaže - pak se ukazuje snímek
 * z vysílání. Obrázek leží v úložišti Kine (bucket thumbnails, složka
 * live/<kanál>/, kam zapisuje jen server - lib/liveThumbnail.ts) a kontrola
 * obsahu ho na pozadí projde stejně jako náhledy videí.
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > LIVE_THUMBNAIL_MAX_BYTES) return NextResponse.json({ error: 'Obrázek je moc velký (nejvýš 3 MB).', code: 'too-big' }, { status: 413 });

  const last = lastUpload.get(user.id) ?? 0;
  if (Date.now() - last < UPLOAD_EVERY_MS) return NextResponse.json({ error: 'Pomaleji - zkus to za pár vteřin.', code: 'slow' }, { status: 429 });

  const { data: stream, error: streamError } = await supabaseServer.from('live_streams').select('*').eq('owner_id', user.id).maybeSingle();
  if (isMissingTable(streamError)) return NextResponse.json({ error: 'Živé vysílání ještě není v databázi zapnuté.' }, { status: 503 });
  if (streamError) return NextResponse.json({ error: streamError.message }, { status: 500 });
  if (!stream) return NextResponse.json({ error: 'Nejdřív si založ klíč pro vysílání.' }, { status: 404 });
  if (!Object.prototype.hasOwnProperty.call(stream, 'thumbnail_url')) {
    return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
  }

  const bytes = new Uint8Array(await req.arrayBuffer().catch(() => new ArrayBuffer(0)));
  lastUpload.set(user.id, Date.now());
  if (lastUpload.size > 5000) lastUpload.clear();
  const check = checkLiveThumbnail(bytes);
  if (!check.ok || !(await decodable(bytes))) {
    const code = check.ok ? 'not-jpeg' : check.code;
    const message = code === 'too-big' ? 'Obrázek je moc velký (nejvýš 3 MB).' : code === 'size' ? 'Obrázek má nezvyklé rozměry.' : 'Tohle není obrázek JPEG.';
    return NextResponse.json({ error: message, code }, { status: 400 });
  }

  const path = newLiveThumbnailPath(user.id, randomUUID());
  const upload = await supabaseServer.storage.from(BUCKET).upload(path, Buffer.from(bytes), { contentType: 'image/jpeg', upsert: false, cacheControl: '86400' });
  if (upload.error) return NextResponse.json({ error: `Obrázek se nepodařilo uložit: ${upload.error.message}` }, { status: 500 });
  const url = supabaseServer.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { error } = await supabaseServer.from('live_streams').update({ thumbnail_url: url, updated_at: new Date().toISOString() }).eq('owner_id', user.id);
  if (error) {
    await removeFile(url, user.id);
    if (isMissingColumn(error)) return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Předchozí náhled už nikdo nepotřebuje.
  if ((stream as Record<string, unknown>).thumbnail_url !== url) await removeFile((stream as Record<string, unknown>).thumbnail_url, user.id);

  runInBackground(import('@/lib/nudityScan').then((m) => m.scanLiveThumbnail(user.id, url)), 'kontrola náhledu přenosu');
  return NextResponse.json({ thumbnailUrl: url, width: check.width, height: check.height }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: stream, error: readError } = await supabaseServer.from('live_streams').select('*').eq('owner_id', user.id).maybeSingle();
  if (readError && !isMissingTable(readError)) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!stream) return NextResponse.json({ thumbnailUrl: null }, { headers: { 'Cache-Control': 'no-store' } });
  if (!Object.prototype.hasOwnProperty.call(stream, 'thumbnail_url')) return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
  const { error } = await supabaseServer.from('live_streams').update({ thumbnail_url: null, updated_at: new Date().toISOString() }).eq('owner_id', user.id);
  if (isMissingColumn(error)) return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await removeFile((stream as Record<string, unknown>).thumbnail_url, user.id);
  return NextResponse.json({ thumbnailUrl: null }, { headers: { 'Cache-Control': 'no-store' } });
}
