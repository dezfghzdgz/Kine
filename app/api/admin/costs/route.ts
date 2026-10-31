import { NextRequest, NextResponse } from 'next/server';
import { isAdminUser, userFromRequest } from '@/lib/apiUser';
import { costReport } from '@/lib/costs';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Hlídač nákladů pro správce (Admin -> Náklady, lib/costs.ts). */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user || !(await isAdminUser(user.id))) return NextResponse.json({ error: 'Jen pro správce.' }, { status: 403 });
  // Každé načtení se ptá Cloudflare - pár za minutu stačí.
  if (!allowRequest(`admin-costs:${user.id}`, 10, 60 * 1000)) return tooManyRequests(30);
  const report = await costReport();
  return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
}
