import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** Vypnutí push oznámení v tomhle prohlížeči. Tělo: { endpoint } */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!allowRequest(`push-unsubscribe:${user.id}`, 20, 60 * 1000)) return tooManyRequests(30);
  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.endpoint ?? '').slice(0, 800);
  if (!endpoint) return NextResponse.json({ error: 'Chybí adresa.' }, { status: 400 });
  await supabaseServer.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
