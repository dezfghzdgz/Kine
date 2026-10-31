import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isAdminUser, userFromRequest } from '@/lib/apiUser';
import { vapidKeysFromEnv } from '@/lib/webPush';

export const dynamic = 'force-dynamic';

/** Stav push oznámení pro správce: jsou nastavené klíče, kolik zařízení je přihlášených. */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user || !(await isAdminUser(user.id))) return NextResponse.json({ error: 'Jen pro správce.' }, { status: 403 });
  const keys = vapidKeysFromEnv();
  const { count, error } = await supabaseServer.from('push_subscriptions').select('id', { count: 'exact', head: true });
  return NextResponse.json(
    {
      configured: !!keys,
      publicKeySet: !!String(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim(),
      privateKeySet: !!String(process.env.VAPID_PRIVATE_KEY ?? '').trim(),
      migrated: !error,
      devices: error ? 0 : count ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
