import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { parseChatRoom, CHAT_MAX_LENGTH, CHAT_MIN_INTERVAL_MS } from '@/lib/liveChat';
import { checkChatMessage, sanitizeChatSettings, SHIELD_SETTINGS, DEFAULT_CHAT_SETTINGS, type ChatPinned, type ChatSettings } from '@/lib/liveChatRules';
import { activeBan, chatRole, listBans, listModerators, loadChatSettings, saveChatSettings, savePinned } from '@/lib/liveChatModeration';
import { emoteMap, isEmoteOnlyMessage, normalizeOutgoing, validChatColor, type ChatBadge, type ChatMeta } from '@/lib/chatEmotes';
import { loadChannelEmotes } from '@/lib/chatEmotesServer';

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
    emoteOnly: s.emoteOnly,
  };
}

/** Chybí sloupec meta / reply_to (migrace chat-emoty ještě neproběhla)? */
function missingMessageColumns(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /meta|reply_to/i.test(error.message ?? ''));
}

/**
 * Pravidla chatu: GET ?room=... vrátí, co platí (pomalý režim, jen
 * odběratelé, jen emoty...), připnutou zprávu, a moderátorům i zakázaná
 * slova, zákazy a seznam moderátorů kanálu.
 */
export async function GET(req: NextRequest) {
  const room = parseChatRoom(req.nextUrl.searchParams.get('room'));
  if (!room) return NextResponse.json({ error: 'Neplatný chat.' }, { status: 400 });
  const user = req.headers.get('authorization') ? await userFromRequest(req) : null;
  const [{ settings, available, pinned, extras }, role] = await Promise.all([
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
      // Režim jen emoty a připínání (migrace chat-emoty).
      extras: available && extras,
      settings: publicSettings(settings),
      pinned,
      role: role.role,
      canModerate,
      ...(canModerate ? { blockedTerms: settings.blockedTerms, bans } : {}),
      ...(moderators ? { moderators } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

type ProfileRow = { username: string | null; is_banned: boolean | null; created_at: string | null; verification_tier?: string | null; chat_color?: string | null };

/** Profil pisatele - s barvou jména, a když sloupec ještě není (migrace), bez ní. */
async function loadProfile(userId: string): Promise<ProfileRow | null> {
  const full = await supabaseServer.from('profiles').select('username, is_banned, created_at, verification_tier, chat_color').eq('id', userId).maybeSingle();
  if (!full.error) return (full.data as ProfileRow | null) ?? null;
  const basic = await supabaseServer.from('profiles').select('username, is_banned, created_at').eq('id', userId).maybeSingle();
  return (basic.data as ProfileRow | null) ?? null;
}

type MessageRow = { id: number; room: string; user_id: string; body: string; profiles?: { username: string | null } | null };

/**
 * Chat živého vysílání a premiér. Číst ho jde přímo z databáze (je veřejný),
 * psát a mazat jen tudy: server ověří přihlášení, blokaci, tempo (jedna
 * zpráva za ~1,5 s) a pravidla chatu (lib/liveChatRules.ts).
 *
 * Tělo: { room, body, replyTo?: id zprávy, action?: true (/me) }. Ke zprávě
 * se uloží (sloupec meta) odznaky (vysílající, moderátor, tým Kine, ověřený,
 * odběratel a jak dlouho), barva jména, první zpráva v chatu kanálu a kopie
 * zprávy, na kterou odpovídá - ať se nic z toho nemusí dohledávat při čtení.
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const room = parseChatRoom(body?.room);
  const raw = String(body?.body ?? '').replace(/\s+/g, ' ').trim();
  if (!room) return NextResponse.json({ error: 'Neplatný chat.' }, { status: 400 });
  if (!raw) return NextResponse.json({ error: 'Prázdná zpráva.' }, { status: 400 });

  const profile = await loadProfile(user.id);
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
  const replyId = Number(body?.replyTo);
  const [{ settings }, ban, lastHere, follow, channelEmotes, replied] = await Promise.all([
    loadChatSettings(room.key),
    activeBan(room.key, user.id),
    supabaseServer.from('live_chat_messages').select('created_at').eq('user_id', user.id).eq('room', room.key).order('created_at', { ascending: false }).limit(1),
    ownerId && ownerId !== user.id
      ? supabaseServer.from('subscriptions').select('created_at').eq('subscriber_id', user.id).eq('channel_id', ownerId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ownerId ? loadChannelEmotes(ownerId) : Promise.resolve([]),
    Number.isFinite(replyId) && replyId > 0
      ? supabaseServer.from('live_chat_messages').select('id, room, user_id, body, profiles(username)').eq('id', replyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  // Emoty: ":kineHype:" -> kineHype, ":fire:" -> 🔥 (klient to dělá taky, tohle je pojistka).
  const emotes = emoteMap(channelEmotes);
  const text = normalizeOutgoing(raw, emotes).slice(0, CHAT_MAX_LENGTH);
  const lastHereAt = lastHere.data?.[0]?.created_at ? new Date(lastHere.data[0].created_at).getTime() : null;
  const followRow = follow.data as { created_at?: string | null } | null;
  const followingSince = followRow ? (followRow.created_at ? new Date(followRow.created_at).getTime() : 0) : null;
  const rejection = checkChatMessage({
    text,
    settings,
    exempt: role !== 'viewer',
    now: Date.now(),
    lastMessageAt: lastHereAt,
    followingSince,
    accountCreatedAt: profile.created_at ? new Date(profile.created_at).getTime() : null,
    ban,
    emoteOnlyMessage: isEmoteOnlyMessage(text, emotes),
  });
  if (rejection) {
    return NextResponse.json({ error: 'Zprávu teď nejde poslat.', ...rejection }, { status: rejection.code === 'slow' ? 429 : 403 });
  }

  const badges: ChatBadge[] = [];
  if (role === 'owner') badges.push('broadcaster');
  if (role === 'staff') badges.push('staff');
  if (role === 'moderator') badges.push('moderator');
  if (profile.verification_tier) badges.push('verified');
  if (followingSince !== null) badges.push('follower');
  const meta: ChatMeta = {};
  if (badges.length) meta.b = badges;
  if (followingSince !== null && followingSince > 0) meta.fm = Math.max(0, Math.floor((Date.now() - followingSince) / (30 * 86400000)));
  if (validChatColor(profile.chat_color)) meta.c = profile.chat_color.toLowerCase();
  if (body?.action === true) meta.me = true;
  // Úplně první zpráva v chatu tohohle kanálu (jako "poprvé v chatu" na Twitchi) - vysílajícímu ne.
  if (lastHereAt === null && role !== 'owner') meta.first = true;
  const target = replied.data as MessageRow | null;
  if (target && target.room === room.key) {
    meta.r = { id: Number(target.id), uid: target.user_id, u: target.profiles?.username ?? '', t: target.body.slice(0, 120) };
  }

  const fields = 'id, room, user_id, body, created_at';
  let insert = await supabaseServer
    .from('live_chat_messages')
    .insert({ room: room.key, user_id: user.id, body: text, meta: Object.keys(meta).length ? meta : null, reply_to: meta.r?.id ?? null })
    .select(`${fields}, meta`)
    .single();
  if (insert.error && missingMessageColumns(insert.error)) {
    // Databáze bez migrace chat-emoty: zpráva projde, jen bez odznaků a odpovědi.
    insert = (await supabaseServer.from('live_chat_messages').insert({ room: room.key, user_id: user.id, body: text }).select(fields).single()) as typeof insert;
  }
  if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });
  return NextResponse.json({ message: insert.data });
}

/**
 * Změna pravidel chatu (majitel, jeho moderátoři, moderátoři Kine):
 * { room, settings: {...} }, { room, shield: true/false }, nebo připnutí
 * { room, pin: id zprávy } / { room, pin: null } (odepnout).
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

  if (body && Object.prototype.hasOwnProperty.call(body, 'pin')) {
    let pinned: ChatPinned | null = null;
    if (body.pin !== null) {
      const id = Number(body.pin);
      if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Neplatná zpráva.' }, { status: 400 });
      const { data } = await supabaseServer.from('live_chat_messages').select('id, room, user_id, body, profiles(username)').eq('id', id).maybeSingle();
      const message = data as MessageRow | null;
      if (!message || message.room !== room.key) return NextResponse.json({ error: 'Zpráva v tomhle chatu není.' }, { status: 404 });
      pinned = { id: Number(message.id), uid: message.user_id, u: message.profiles?.username ?? '', t: message.body, at: new Date().toISOString() };
    }
    const error = await savePinned(room.key, pinned);
    if (error) return NextResponse.json({ error }, { status: 503 });
    return NextResponse.json({ pinned });
  }

  let next: ChatSettings;
  if (body?.shield === true) next = { ...current, ...SHIELD_SETTINGS, shield: true };
  else if (body?.shield === false) next = { ...DEFAULT_CHAT_SETTINGS, blockedTerms: current.blockedTerms, emoteOnly: current.emoteOnly, shield: false };
  else next = sanitizeChatSettings({ ...current, ...(body?.settings ?? {}), shield: current.shield });
  const error = await saveChatSettings(room.key, next);
  if (error) return NextResponse.json({ error }, { status: /migraci/.test(error) ? 503 : 500 });
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
  // Smazaná zpráva nesmí zůstat připnutá.
  if (room) {
    const { pinned } = await loadChatSettings(room.key);
    if (pinned?.id === id) await savePinned(room.key, null);
  }
  return NextResponse.json({ ok: true });
}
