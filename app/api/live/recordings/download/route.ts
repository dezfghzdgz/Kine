import { NextRequest, NextResponse } from 'next/server';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';
import { userFromRequest } from '@/lib/apiUser';
import { recordingDownload } from '@/lib/liveRecording';

export const dynamic = 'force-dynamic';

/**
 * Záznam vysílání do PC (studio na webu, appka po skončení vysílání): adresa
 * MP4. Cloudflare ho nejdřív vyrobí - "inprogress" = zeptat se znovu za chvíli.
 * Jen záznamy vlastního vstupu (lib/liveRecording.ts). Vlastní cesta schválně:
 * starší web na ni odpoví 404 a nic neudělá (dřív by tentýž požadavek na
 * /api/live/recordings záznam zveřejnil).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  // 0146: brzda - každé volání jde na Cloudflare / Stripe (společný limit účtu).
  if (!allowRequest(`recordings-download:${user.id}`, 10, 60000)) return tooManyRequests(60);
  const body = await req.json().catch(() => ({}));
  const uid = String(body?.videoUid ?? '').trim() || 'latest';
  const result = await recordingDownload(user.id, uid);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ uid: result.uid, status: result.status, url: result.url, percent: result.percent }, { headers: { 'Cache-Control': 'no-store' } });
}
