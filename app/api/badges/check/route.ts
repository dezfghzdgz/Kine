import { NextRequest, NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/apiUser';
import { checkBadges } from '@/lib/badgeCheck';

export const dynamic = 'force-dynamic';

/**
 * Má přihlášený nový odznak? Když ano, pošle oznámení (lib/badgeCheck.ts)
 * a vrátí ho - prohlížeč ukáže oslavné okénko (components/BadgeWatcher.tsx).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const result = await checkBadges(user.id);
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason });
  return NextResponse.json({ ok: true, fresh: result.fresh, first: result.first, total: result.total });
}
