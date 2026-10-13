import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { notifyNewPost } from '@/lib/postNotify';

export const dynamic = 'force-dynamic';

/** Oznámení jen u čerstvého příspěvku (appka ho posílá hned po zveřejnění). */
const FRESH_MS = 10 * 60 * 1000;

/**
 * Nový příspěvek -> oznámení odběratelům se zvonečkem (lib/postNotify.ts).
 * Jen majitel, jen čerstvý příspěvek a jen jednou.
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return NextResponse.json({ error: 'Neplatný příspěvek.' }, { status: 400 });

  const { data: post } = await supabaseServer.from('posts').select('id, owner_id, type, content, created_at').eq('id', postId).maybeSingle();
  if (!post || post.owner_id !== user.id) return NextResponse.json({ error: 'Příspěvek nenalezen.' }, { status: 404 });
  if (Date.now() - Date.parse(post.created_at) > FRESH_MS) return NextResponse.json({ ok: false, reason: 'old' });

  const result = await notifyNewPost(post);
  return NextResponse.json(result);
}
