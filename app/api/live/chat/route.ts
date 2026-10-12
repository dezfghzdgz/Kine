import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { parseChatRoom, CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS } from '@/lib/liveChat';
import { checkChatMessage, sanitizeChatSettings, SHIELD_SETTINGS, DEFAULT_CHAT_SETTINGS, type ChatSettings } from '@/lib/liveChatRules';
import { activeBan, chatRole, listBans, listModerators, loadChatSettings, saveChatSettings } from '@/lib/liveChatModeration';

export const dynamic = 'force-dynamic';

/** Co z nastavení vidí každý (zakázaná slova jen moderátoři - jinak by je šlo obcházet). */
function publicSettings(s: ChatSettings) {
  return {
    slowSeconds: s.slowSeconds,
    followersOnly: s.followersOnly,
    followMinutes: s.followMinutes,
    blockLinks: s.blockLinks,
    minAccountMinutes: s.minAccountMinutes,
    shield: s.shield,
  };
}

/**
 * Pravidla chatu: GET ?room=... vrátí, co platí (pomalý režim, jen
 * odběratelé...), a moderátorům i zakázaná slova, zákazy a seznam
 * moderátorů kanálu.
 */
export async function GET(req: NextRequest) {
  const room = parseChatRoom(req.nextUrl.searchParams.get('room'));
  if (!room) return NextResponse.json({ error: 'Neplatný chat.' }, { status: 400 });
  const user = req.headers.get('authorization') ? await userFromRequest(req) : null;
  const [{ settings, available }, role] = await Promise.all([
    loadChatSettings(room.key),
    user ? chatRole(user.id, room) : Promise.resolve({ role: 'viewer' as const, ownerId: null }),
  ]);
  const canModerate = role.role !== 'viewer';
  const [bans, moderators] = await Promise.all([
    canModerate && available ? listBans(room.key) : Promise.resolve([]),
    (role.role === 'owner' || role.role === 'staff') && available && role.ownerId ? listModerators(role.ownerId) : Promise.resolve(null),
  ]);
  return NextResponse.json(
    {
      available,
      settings: publicSettings(settings),
      role: role.role,
      canModerate,
      ...(canModerate ? { blockedTerms: settings.blockedTerms, bans } : {}),
      ...(moderators ? { moderators } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

/**
 * Chat živého vysílání a premiér. Číst ho jde přímo z databáze (je veřejný),
 * psát a mazat jen tudy: server ověří přihlášení, blokaci, tempo (jedna
 * zpráva za ~1,5 s) a pravidla chatu (lib/liveChatRules.ts).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const room = parseChatRoom(body?.room);
  const text = String(body?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
  if (!room) return NextResponse.json({ error: 'Neplatný chat.' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'Prázdná zpráva.' }, { status: 400 });

  const { data: profile } = await supabaseServer.from('profiles').select('is_banned, created_at').eq('id', user.id).maybeSingle();
  if (!profile || profile.is_banned) return NextResponse.json({ error: 'Účet nemůže psát do chatu.', code: 'banned' }, { status: 403 });

  const last = await supabaseServer
    .from('live_chat_messages')
    .select('created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (isMissingTable(last.error)) return NextResponse.json({ error: 'Chat ještě není v databázi zapnutý.' }, { status: 503 });
  const lastAt = last.data?.[0]?.created_at ? new Date(last.data[0].created_at).getTime() : 0;
  if (Date.now() - lastAt < CHAT_MIN_INTERVAL_MS) return NextResponse.json({ error: 'Pomaleji :)', code: 'slow', seconds: 2 }, { status: 429 });

  const { role, ownerId } = await chatRole(user.id, room);
  const [{ settings }, ban, lastHere, follow] = await Promise.all([
    loadChatSettings(room.key),
    activeBan(room.key, user.id),
    supabaseServer.from('live_chat_messages').select('created_at').eq('user_id', user.id).eq('room', room.key).order('created_at', { ascending: false }).limit(1),
    ownerId && ownerId !== user.id
      ? supabaseServer.from('subscriptions').select('created_at').eq('subscriber_id', user.id).eq('channel_id', ownerId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const lastHereAt = lastHere.data?.[0]?.created_at ? new Date(lastHere.data[0].created_at).getTime() : null;
  const followRow = follow.data as { created_at?: string | null } | null;
  const rejection = checkChatMessage({
    text,
    settings,
    exempt: role !== 'viewer',
    now: Date.now(),
    lastMessageAt: lastHereAt,
    followingSince: followRow ? (followRow.created_at ? new Date(followRow.created_at).getTime() : 0) : null,
    accountCreatedAt: profile.created_at ? new Date(profile.created_at).getTime() : null,
    ban,
  });
  if (rejection) {
    return NextResponse.json({ error: 'Zprávu teď nejde poslat.', ...rejection }, { status: rejection.code === 'slow' ? 429 : 403 });
  }

  const { data, error } = await supabaseServer
    .from('live_chat_messages')
    .insert({ room: room.key, user_id: user.id, body: text })
    .select('id, room, user_id, body, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}

/**
 * Změna pravidel chatu (majitel, jeho moderátoři, moderátoři Kine):
 * { room, settings: {...} } nebo { room, shield: true/false }.
 */
export async function PATCH(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const room = parseChatRoom(body?.room);
  if (!room) return NextResponse.json({ error: 'Neplatný chat.' }, { status: 400 });
  const { role } = await chatRole(user.id, room);
  if (role === 'viewer') return NextResponse.json({ error: 'Pravidla chatu mění jen majitel a moderátoři.' }, { status: 403 });

  const { settings: current, available } = await loadChatSettings(room.key);
  if (!available) return NextResponse.json({ error: 'Pravidla chatu potřebují migraci supabase-migration-zive-2.sql.' }, { status: 503 });
  let next: ChatSettings;
  if (body?.shield === true) next = { ...current, ...SHIELD_SETTINGS, shield: true };
  else if (body?.shield === false) next = { ...DEFAULT_CHAT_SETTINGS, blockedTerms: current.blockedTerms, shield: false };
  else next = sanitizeChatSettings({ ...current, ...(body?.settings ?? {}), shield: current.shield });
  const error = await saveChatSettings(room.key, next);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ settings: publicSettings(next), blockedTerms: next.blockedTerms });
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
  if (!allowed && room) allowed = (await chatRole(user.id, room)).role !== 'viewer';
  if (!allowed) return NextResponse.json({ error: 'Tuhle zprávu smazat nemůžeš.' }, { status: 403 });

  await supabaseServer.from('live_chat_messages').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
