import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { uploadSummary, uploadsPaused } from '@/lib/uploadLimits';
import { limitsForProfile, uploadProfile, uploadUsage } from '@/lib/uploadTickets';

export const dynamic = 'force-dynamic';

/**
 * Limity nahrávání přihlášeného (lib/uploadLimits.ts) a kolik z nich už
 * využil - stránka nahrávání ukáže "dnes ještě X videí, úložiště Y z Z" a
 * na moc dlouhé video upozorní hned, ne až po nahrání.
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error } = await supabaseServer.auth.getUser(token);
  if (error || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const profile = await uploadProfile(userData.user.id);
  const limits = limitsForProfile(profile, userData.user.created_at ?? null);
  const { usage } = await uploadUsage(userData.user.id);
  return NextResponse.json(
    { ...uploadSummary(limits, usage), paused: !!uploadsPaused(process.env), banned: profile?.is_banned === true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
