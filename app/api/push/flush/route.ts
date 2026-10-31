import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/apiUser';
import { pushFromSender } from '@/lib/pushSend';
import { runInBackground } from '@/lib/background';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Prohlížeč právě vložil oznámení pro někoho jiného (odpověď na komentář,
 * pozvánka ke spolupráci) - pošli je na jeho zařízení. Bere se jen to, co
 * tenhle uživatel poslal za poslední 2 minuty a ještě neodešlo
 * (lib/pushSend.ts - pushFromSender); nic jiného se tudy poslat nedá.
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!allowRequest(`push-flush:${user.id}`, 30, 60 * 1000)) return tooManyRequests(20);
  runInBackground(pushFromSender(user.id), 'push oznámení');
  return NextResponse.json({ ok: true }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
