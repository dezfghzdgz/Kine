import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { parseChatRoom } from '@/lib/liveChat';
import { TIMEOUT_MINUTES } from '@/lib/liveChatRules';
import { chatRole } from '@/lib/liveChatModeration';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Příkaz v chatu (/ban jméno) posílá jméno místo id - najít účet (velikost písmen nevadí). */
async function userIdByName(name: unknown): Promise<string | null> {
  const clean = String(name ?? '').replace(/^@/, '').trim();
  if (!/^[\p{L}\p{N}_.-]{2,30}$/u.test(clean)) return null;
  // Přesná shoda bez ohledu na velikost písmen: % a _ v ilike neplatí jako zástupné znaky.
  const pattern = clean.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data } = await supabaseServer.from('profiles').select('id').ilike('username', pattern).limit(2);
  const rows = (data ?? []) as { id: string }[];
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * Ztlumení / zákaz / zrušení zákazu v chatu: { room, userId, action:
 * 'timeout' | 'ban' | 'unban', minutes? }. Smí majitel kanálu, jeho
 * moderátoři a moderátoři Kine - a ne na sebe navzájem (moderátor
 * neztlumí majitele ani jiného moderátora). Ztlumený nebo zakázaný
 * přijde i o zprávy z poslední půlhodiny (jako "vyčistit chat" na Twitchi).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const room = parseChatRoom(body?.room);
  let target = String(body?.userId ?? '');
  const action = String(body?.action ?? '');
  if (!room || !['timeout', 'ban', 'unban'].includes(action)) {
    return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  }
  if (!UUID.test(target) && body?.username) {
    const found = await userIdByName(body.username);
    if (!found) return NextResponse.json({ error: 'Takového uživatele nenajdu.', code: 'no-user' }, { status: 404 });
    target = found;
  }
  if (!UUID.test(target)) return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });

  const me = await chatRole(user.id, room);
  if (me.role === 'viewer') return NextResponse.json({ error: 'Moderovat chat smí jen majitel a moderátoři.' }, { status: 403 });
  if (target === user.id) return NextResponse.json({ error: 'Sám sebe ztlumit nejde.' }, { status: 400 });
  const them = await chatRole(target, room, me.ownerId);
  if (them.role !== 'viewer') return NextResponse.json({ error: 'Majitele kanálu ani moderátory ztlumit nejde.' }, { status: 403 });

  if (action === 'unban') {
    const { error } = await supabaseServer.from('live_chat_bans').delete().eq('room', room.key).eq('user_id', target);
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ ok: true });
  }

  const minutes = Number(body?.minutes);
  const until = action === 'ban' ? null : new Date(Date.now() + (TIMEOUT_MINUTES.includes(minutes) ? minutes : 10) * 60000).toISOString();
  const { error } = await supabaseServer
    .from('live_chat_bans')
    .upsert({ room: room.key, user_id: target, until, created_by: user.id, created_at: new Date().toISOString() }, { onConflict: 'room,user_id' });
  if (error) {
    return NextResponse.json(
      { error: /live_chat_bans/.test(error.message) ? 'Ztlumení potřebuje migraci supabase-migration-zive-2.sql.' : error.message },
      { status: 503 }
    );
  }
  // Vyčistit jeho nedávné zprávy (spam, nadávky) - ať po nich nezůstane stopa.
  const halfHourAgo = new Date(Date.now() - 30 * 60000).toISOString();
  await supabaseServer.from('live_chat_messages').delete().eq('room', room.key).eq('user_id', target).gte('created_at', halfHourAgo);
  return NextResponse.json({ ok: true, until });
}
