import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { parseChatRoom } from '@/lib/liveChat';
import { chatRole, roomOwnerId } from '@/lib/liveChatModeration';
import { EMOTE_MAX_BYTES, MAX_CHANNEL_EMOTES, validChannelEmoteCode } from '@/lib/chatEmotes';
import { listChannelEmotes } from '@/lib/chatEmotesServer';
import { checkEmoteImage, emoteImageInfo, emotePathFromUrl, emoteStoragePath } from '@/lib/emoteImage';
import { runInBackground } from '@/lib/background';

export const dynamic = 'force-dynamic';
// Na pozadí běží kontrola obsahu emotu (lib/nudityScan.ts).
export const maxDuration = 60;

const BUCKET = 'thumbnails';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_MIGRATION = 'Emoty kanálu potřebují migraci supabase-migration-chat-emoty.sql.';
/** Náhled pro kontrolu obsahu (JPEG prvního snímku) nejvýš tolik. */
const SCAN_MAX_BYTES = 400 * 1024;

/** Jeden člověk nejvýš jedno nahrání za tolik (na instanci serveru). */
const UPLOAD_EVERY_MS = 3000;
const lastUpload = new Map<string, number>();

/** Kanál z ?room=channel:<id> / video:<id> nebo ?channel=<id>. */
async function channelFrom(params: URLSearchParams | FormData): Promise<{ ownerId: string | null; room: ReturnType<typeof parseChatRoom> }> {
  const room = parseChatRoom(params.get('room'));
  if (room) return { ownerId: await roomOwnerId(room), room };
  const channel = String(params.get('channel') ?? '');
  return { ownerId: UUID.test(channel) ? channel.toLowerCase() : null, room: UUID.test(channel) ? parseChatRoom(`channel:${channel}`) : null };
}

/**
 * Emoty kanálu: GET ?room=... (nebo ?channel=<id>) je vrátí komukoli -
 * chat je potřebuje k vykreslení zpráv (i překryv pro OBS a záznam chatu).
 * Odpověď smí chvíli držet CDN (nový emote se ukáže do půl minuty).
 */
export async function GET(req: NextRequest) {
  const { ownerId } = await channelFrom(req.nextUrl.searchParams);
  if (!ownerId) return NextResponse.json({ emotes: [], available: false, max: MAX_CHANNEL_EMOTES }, { status: 400 });
  const { emotes, available } = await listChannelEmotes(ownerId);
  const anonymous = !req.headers.get('authorization');
  return NextResponse.json(
    { ownerId, emotes, available, max: MAX_CHANNEL_EMOTES },
    { headers: { 'Cache-Control': anonymous ? 'public, max-age=0, s-maxage=30, stale-while-revalidate=300' : 'no-store' } }
  );
}

/** Smí člověk spravovat emoty kanálu? Majitel kanálu a tým Kine (moderátoři kanálu ne - jako na Twitchi). */
async function canManage(userId: string, room: NonNullable<ReturnType<typeof parseChatRoom>>, ownerId: string): Promise<boolean> {
  const { role } = await chatRole(userId, room, ownerId);
  return role === 'owner' || role === 'staff';
}

/**
 * Nový emote (formulář): room, code, image (PNG / GIF / WebP do 512 kB,
 * 18-512 px, i animovaný), scan (první snímek jako JPEG - kontrola obsahu).
 * Prohlížeč statické obrázky předem zmenší na 112 px (ChatEmotePicker).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > EMOTE_MAX_BYTES + SCAN_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: 'Obrázek je moc velký (nejvýš 512 kB).', code: 'too-big' }, { status: 413 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Chybí obrázek.' }, { status: 400 });
  const { ownerId, room } = await channelFrom(form);
  if (!ownerId || !room) return NextResponse.json({ error: 'Neplatný kanál.' }, { status: 400 });
  if (!(await canManage(user.id, room, ownerId))) return NextResponse.json({ error: 'Emoty kanálu spravuje jen jeho majitel.' }, { status: 403 });

  const code = String(form.get('code') ?? '').trim();
  if (!validChannelEmoteCode(code)) return NextResponse.json({ error: 'Kód emotu: 2-24 písmen, číslic nebo _, na začátku písmeno (a ne jako emote Kine).', code: 'bad-code' }, { status: 400 });

  const image = form.get('image');
  const scan = form.get('scan');
  if (!(image instanceof Blob) || !(scan instanceof Blob)) return NextResponse.json({ error: 'Chybí obrázek.' }, { status: 400 });
  const bytes = new Uint8Array(await image.arrayBuffer());
  const info = emoteImageInfo(bytes);
  const problem = checkEmoteImage(info, bytes.length, EMOTE_MAX_BYTES);
  if (problem || !info) {
    const message =
      problem === 'too-big' ? 'Obrázek je moc velký (nejvýš 512 kB).' : problem === 'size' ? 'Emote má mít 18-512 px a zhruba čtvercový tvar.' : 'Tohle není obrázek PNG, GIF ani WebP.';
    return NextResponse.json({ error: message, code: problem ?? 'not-image' }, { status: 400 });
  }
  const scanBytes = new Uint8Array(await scan.arrayBuffer());
  if (scanBytes.length < 4 || scanBytes.length > SCAN_MAX_BYTES || scanBytes[0] !== 0xff || scanBytes[1] !== 0xd8) {
    return NextResponse.json({ error: 'Chybí náhled pro kontrolu obsahu.', code: 'scan' }, { status: 400 });
  }

  const { emotes, available } = await listChannelEmotes(ownerId);
  if (!available) return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
  if (emotes.length >= MAX_CHANNEL_EMOTES) return NextResponse.json({ error: `Kanál může mít nejvýš ${MAX_CHANNEL_EMOTES} emotů.`, code: 'full' }, { status: 409 });
  if (emotes.some((e) => e.code.toLowerCase() === code.toLowerCase())) return NextResponse.json({ error: 'Emote s tímhle kódem už kanál má.', code: 'taken' }, { status: 409 });

  // Tempo až před nahráním: špatně vybraný soubor jde hned opravit, nahrávat se ale nedá pořád dokola.
  const last = lastUpload.get(user.id) ?? 0;
  if (Date.now() - last < UPLOAD_EVERY_MS) return NextResponse.json({ error: 'Pomaleji - zkus to za pár vteřin.', code: 'slow' }, { status: 429 });
  lastUpload.set(user.id, Date.now());
  if (lastUpload.size > 5000) lastUpload.clear();

  const id = randomUUID();
  const path = emoteStoragePath(ownerId, id, info.ext);
  const upload = await supabaseServer.storage.from(BUCKET).upload(path, Buffer.from(bytes), { contentType: info.type, upsert: false, cacheControl: '31536000' });
  if (upload.error) return NextResponse.json({ error: `Obrázek se nepodařilo uložit: ${upload.error.message}` }, { status: 500 });
  const url = supabaseServer.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const { data, error } = await supabaseServer
    .from('channel_emotes')
    .insert({ id, channel_id: ownerId, code, image_url: url, animated: info.animated, created_by: user.id })
    .select('id, code, image_url, animated')
    .single();
  if (error) {
    await supabaseServer.storage.from(BUCKET).remove([path]).then(() => undefined, () => undefined);
    if (isMissingTable(error)) return NextResponse.json({ error: NEEDS_MIGRATION, code: 'migration' }, { status: 503 });
    if (error.code === '23505') return NextResponse.json({ error: 'Emote s tímhle kódem už kanál má.', code: 'taken' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  runInBackground(import('@/lib/nudityScan').then((m) => m.scanChatEmote(ownerId, id, path, scanBytes)), 'kontrola emotu');
  const row = data as { id: string; code: string; image_url: string; animated: boolean | null };
  return NextResponse.json(
    { emote: { id: row.id, code: row.code, url: row.image_url, channel: true, ...(row.animated ? { animated: true } : {}) } },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Smazat emote: ?room=...&id=<id emotu>. */
export async function DELETE(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { ownerId, room } = await channelFrom(req.nextUrl.searchParams);
  const id = String(req.nextUrl.searchParams.get('id') ?? '');
  if (!ownerId || !room || !UUID.test(id)) return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  if (!(await canManage(user.id, room, ownerId))) return NextResponse.json({ error: 'Emoty kanálu spravuje jen jeho majitel.' }, { status: 403 });
  const { data, error } = await supabaseServer.from('channel_emotes').delete().eq('id', id).eq('channel_id', ownerId).select('image_url');
  if (error) return NextResponse.json({ error: isMissingTable(error) ? NEEDS_MIGRATION : error.message }, { status: isMissingTable(error) ? 503 : 500 });
  const path = emotePathFromUrl((data as { image_url?: string }[] | null)?.[0]?.image_url, ownerId);
  if (path) await supabaseServer.storage.from(BUCKET).remove([path]).then(() => undefined, () => undefined);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
