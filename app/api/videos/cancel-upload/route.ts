import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isCloudflareUid } from '@/lib/cloudflareVideos';
import { cancelTicket } from '@/lib/uploadTickets';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Zrušené nahrávání - tlačítko Zrušit v appce Kine Clipper, nebo appka /
 * stránka po nepovedeném pokusu (lib/uploadTickets.ts - cancelTicket).
 *
 * Tělo: { cloudflareVideoId }
 *
 * Lístek se uvolní hned: nahrávání se přestane počítat mezi rozpracovaná
 * (dřív opuštěné nahrávání blokovalo další celý den) a rezerva u Cloudflare
 * se smaže. Hotové video se tudy nesmaže (409) - na to je /api/videos/delete.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!allowRequest(`cancel-upload:${userData.user.id}`, 60, 60 * 1000)) return tooManyRequests(20);

  const body = await req.json().catch(() => ({}));
  const uid = typeof body?.cloudflareVideoId === 'string' ? body.cloudflareVideoId.trim() : '';
  if (!isCloudflareUid(uid)) return NextResponse.json({ error: 'Chybí id nahrávání.' }, { status: 400 });

  const outcome = await cancelTicket(userData.user.id, uid);
  const headers = { 'Cache-Control': 'no-store' };
  switch (outcome) {
    case 'canceled':
    case 'already':
      return NextResponse.json({ ok: true, outcome }, { headers });
    case 'used':
      return NextResponse.json({ error: 'Video je už nahrané - smazat ho jde v Moje videa.', code: 'used' }, { status: 409, headers });
    case 'other-user':
    case 'not-found':
      return NextResponse.json({ error: 'Tohle nahrávání nepatří tobě.' }, { status: 404, headers });
    default:
      return NextResponse.json({ error: 'Nahrávání se teď nepodařilo zrušit - zkus to za chvíli.' }, { status: 503, headers });
  }
}
