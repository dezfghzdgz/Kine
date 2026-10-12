import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { listModerators } from '@/lib/liveChatModeration';

export const dynamic = 'force-dynamic';

const MAX_MODERATORS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moderátoři chatu kanálu - vybírá si je majitel (studio /live). Mazat
 * zprávy, ztlumit a zakázat psaní pak můžou i oni, takže streamer nemusí
 * moderovat uprostřed hry. { action: 'add', username } | { action: 'remove', userId }.
 */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  return NextResponse.json({ moderators: await listModerators(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');

  if (action === 'remove') {
    const target = String(body?.userId ?? '');
    if (!UUID.test(target)) return NextResponse.json({ error: 'Neplatný uživatel.' }, { status: 400 });
    await supabaseServer.from('channel_moderators').delete().eq('channel_id', user.id).eq('user_id', target);
    return NextResponse.json({ moderators: await listModerators(user.id) });
  }

  if (action !== 'add') return NextResponse.json({ error: 'Neznámá akce.' }, { status: 400 });
  const username = String(body?.username ?? '').trim().replace(/^@/, '');
  if (!username) return NextResponse.json({ error: 'Napiš jméno uživatele.' }, { status: 400 });
  // Přesně podle jména, jinak bez ohledu na velikost písmen (jen když je takový jediný).
  let { data: target } = await supabaseServer.from('profiles').select('id, is_banned').eq('username', username).maybeSingle();
  if (!target) {
    const { data: similar } = await supabaseServer.from('profiles').select('id, is_banned').ilike('username', username.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(2);
    if (similar && similar.length === 1) target = similar[0];
  }
  if (!target) return NextResponse.json({ error: 'Takový uživatel na Kine není.', code: 'notFound' }, { status: 404 });
  if (target.id === user.id) return NextResponse.json({ error: 'Svůj kanál moderuješ i tak.' }, { status: 400 });
  if (target.is_banned) return NextResponse.json({ error: 'Zablokovaný účet nemůže být moderátor.' }, { status: 400 });

  const current = await listModerators(user.id);
  if (current.length >= MAX_MODERATORS) return NextResponse.json({ error: `Nejvýš ${MAX_MODERATORS} moderátorů.` }, { status: 400 });
  const { error } = await supabaseServer.from('channel_moderators').upsert({ channel_id: user.id, user_id: target.id }, { onConflict: 'channel_id,user_id' });
  if (error) {
    return NextResponse.json(
      { error: /channel_moderators/.test(error.message) ? 'Moderátoři potřebují migraci supabase-migration-zive-2.sql.' : error.message },
      { status: 503 }
    );
  }
  return NextResponse.json({ moderators: await listModerators(user.id) });
}
