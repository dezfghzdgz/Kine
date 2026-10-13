import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/apiUser';
import { discardRecording } from '@/lib/liveRecording';

export const dynamic = 'force-dynamic';

/**
 * Zahodit záznam vysílání: smaže se u Cloudflare hned a nikde se neuloží.
 * Vždy konkrétní záznam (id) - "nejnovější" ne: mezitím mohlo začít jiné
 * vysílání a smazal by se jeho záznam. Jen záznamy vlastního vstupu, ne ty,
 * ze kterých už je video na Kine (lib/liveRecording.ts).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const uid = String(body?.videoUid ?? '').trim();
  if (!uid || uid === 'latest') return NextResponse.json({ error: 'Chybí, který záznam zahodit.' }, { status: 400 });
  const result = await discardRecording(user.id, uid);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ uid: result.uid, discarded: true });
}
