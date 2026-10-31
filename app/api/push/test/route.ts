import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/apiUser';
import { pushTest } from '@/lib/pushSend';
import { vapidKeysFromEnv } from '@/lib/webPush';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/** Zkušební oznámení na všechna moje zařízení (Nastavení -> Oznámení). */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!allowRequest(`push-test:${user.id}`, 3, 60 * 1000)) return tooManyRequests(60);
  if (!vapidKeysFromEnv()) return NextResponse.json({ error: 'Push oznámení nejsou na serveru nastavená.', code: 'not-configured' }, { status: 503 });
  const result = await pushTest(user.id);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
