import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { parseChatRoom, CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS } from '@/lib/liveChat';

export const dynamic = 'force-dynamic';

/**
 * Chat živého vysílání a premiér. Číst ho jde přímo z databáze (je veřejný),
 * psát a mazat jen tudy: server ověří přihlášení, blokaci a tempo (jedna
 * zpráva za ~1,5 s), a smazat smí autor, majitel kanálu/videa a moderátor.
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const room = parseChatRoom(body?.room);
  const text = String(body?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
  if (!room) return NextResponse.json({ error: 'Neplatný chat.' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'Prázdná zpráva.' }, { status: 400 });

  const { data: profile } = await supabaseServer.from('profiles').select('is_banned').eq('id', user.id).maybeSingle();
  if (!profile || profile.is_banned) return NextResponse.json({ error: 'Účet nemůže psát do chatu.' }, { status: 403 });

  const last = await supabaseServer
    .from('live_chat_messages')
    .select('created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (isMissingTable(last.error)) return NextResponse.json({ error: 'Chat ještě není v databázi zapnutý.' }, { status: 503 });
  const lastAt = last.data?.[0]?.created_at ? new Date(last.data[0].created_at).getTime() : 0;
  if (Date.now() - lastAt < CHAT_MIN_INTERVAL_MS) return NextResponse.json({ error: 'Pomaleji :)' }, { status: 429 });

  const { data, error } = await supabaseServer
    .from('live_chat_messages')
    .insert({ room: room.key, user_id: user.id, body: text })
    .select('id, room, user_id, body, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}

export async function DELETE(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Neplatná zpráva.' }, { status: 400 });

  const { data: message } = await supabaseServer.from('live_chat_messages').select('id, room, user_id').eq('id', id).maybeSingle();
  if (!message) return NextResponse.json({ ok: true });

  let allowed = message.user_id === user.id;
  const room = parseChatRoom(message.room);
  if (!allowed && room?.kind === 'channel') allowed = room.id === user.id;
  if (!allowed && room?.kind === 'video') {
    const { data: video } = await supabaseServer.from('videos').select('owner_id').eq('id', room.id).maybeSingle();
    allowed = video?.owner_id === user.id;
  }
  if (!allowed) {
    const { data: me } = await supabaseServer.from('profiles').select('role').eq('id', user.id).maybeSingle();
    allowed = me?.role === 'moderator' || me?.role === 'admin';
  }
  if (!allowed) return NextResponse.json({ error: 'Tuhle zprávu smazat nemůžeš.' }, { status: 403 });

  await supabaseServer.from('live_chat_messages').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
