import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/apiUser';
import { discardRecording, discardStreamRecordings } from '@/lib/liveRecording';
import { parseStreamWindow } from '@/lib/liveRecordingRules';

export const dynamic = 'force-dynamic';

/**
 * Zahodit záznam vysílání: smaže se u Cloudflare hned a nikde se neuloží.
 *
 * - `videoUid`: konkrétní záznam (studio, appka, která id zná),
 * - `since` + `until` (ms): záznamy vysílání z tohohle okna - appka, která id
 *   nezná (Cloudflare přenos za vysílání nepotvrdil). Když záznam ještě není,
 *   odpověď 404 s `retry: true` - appka to zkusí znovu. `clientNow` = hodiny
 *   appky při odeslání: okno se posune na čas serveru (hodiny počítače se
 *   můžou o minuty lišit).
 *
 * "Nejnovější" ne: mezitím mohlo začít jiné vysílání a smazal by se jeho
 * záznam. Jen záznamy vlastního vstupu, ne ty, ze kterých už je video na Kine
 * (lib/liveRecording.ts).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const uid = String(body?.videoUid ?? '').trim();
  let result;
  if (uid && uid !== 'latest') {
    result = await discardRecording(user.id, uid);
  } else {
    const window = parseStreamWindow(body?.since, body?.until, Date.now(), body?.clientNow);
    if (!window) return NextResponse.json({ error: 'Chybí, který záznam zahodit.' }, { status: 400 });
    result = await discardStreamRecordings(user.id, window);
  }
  if (!result.ok) return NextResponse.json({ error: result.error, retry: result.retry === true }, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ uid: result.uid, uids: result.uids ?? [result.uid], discarded: true }, { headers: { 'Cache-Control': 'no-store' } });
}
