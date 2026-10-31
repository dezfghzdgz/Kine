import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { b64urlDecode, isPushEndpoint, vapidKeysFromEnv } from '@/lib/webPush';
import { isPushLang } from '@/lib/pushText';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** Kolik zařízení smí mít jeden účet (nejstarší navíc se smaže). */
const MAX_DEVICES = 10;

/**
 * Zapnutí push oznámení v tomhle prohlížeči: uloží adresu push služby a
 * klíče zařízení. Adresa musí mířit na push službu prohlížeče (lib/webPush.ts -
 * isPushEndpoint), jinak by šlo server posílat na libovolnou adresu.
 *
 * Tělo: { subscription: { endpoint, keys: { p256dh, auth } }, lang }
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!allowRequest(`push-subscribe:${user.id}`, 20, 60 * 1000)) return tooManyRequests(30);
  if (!vapidKeysFromEnv()) return NextResponse.json({ error: 'Push oznámení nejsou na serveru nastavená.', code: 'not-configured' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.subscription?.endpoint ?? '');
  const p256dh = String(body?.subscription?.keys?.p256dh ?? '');
  const auth = String(body?.subscription?.keys?.auth ?? '');
  const lang = isPushLang(body?.lang) ? body.lang : 'en';
  if (!isPushEndpoint(endpoint) || endpoint.length > 800) return NextResponse.json({ error: 'Neplatná adresa oznámení.' }, { status: 400 });
  let keyOk = false;
  try {
    const pub = b64urlDecode(p256dh);
    const sec = b64urlDecode(auth);
    keyOk = pub.length === 65 && pub[0] === 0x04 && sec.length >= 16 && sec.length <= 32 && /^[A-Za-z0-9_-]+$/.test(p256dh + auth);
  } catch {
    keyOk = false;
  }
  if (!keyOk) return NextResponse.json({ error: 'Neplatné klíče zařízení.' }, { status: 400 });

  const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 300);
  // Stejný prohlížeč s jiným účtem = adresa přejde na nového majitele.
  const { error } = await supabaseServer
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth, lang, user_agent: userAgent, failures: 0 }, { onConflict: 'endpoint' });
  if (error) {
    const missing = /push_subscriptions|schema cache|does not exist/i.test(error.message ?? '');
    if (!missing) console.error('Kine: push subscribe -', error.message);
    return NextResponse.json({ error: missing ? 'Push oznámení ještě nejsou zapnutá v databázi.' : 'Oznámení se nepodařilo zapnout.', code: missing ? 'migration' : 'error' }, { status: 503 });
  }

  // Nejvýš MAX_DEVICES zařízení - nejstarší navíc pryč.
  const { data: devices } = await supabaseServer.from('push_subscriptions').select('id, created_at').eq('user_id', user.id).order('created_at', { ascending: false });
  const extra = (devices ?? []).slice(MAX_DEVICES).map((d: { id: string }) => d.id);
  if (extra.length) await supabaseServer.from('push_subscriptions').delete().in('id', extra);

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
