import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { badgeStatsFor } from '@/lib/badgeCheck';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';
import { clientIp } from '@/lib/clientIp';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Čísla pro odznaky kanálu (lib/badgeCheck.ts - badgeStatsFor): videa,
 * zhlédnutí, lajky, nejsledovanější video, odběratelé, Sparks, hodiny
 * živě, příspěvky, komentáře, spolupráce. Kanál je dřív počítal
 * v prohlížeči jen z videí - nové řady potřebují víc dotazů, a ty patří
 * na server. Jen veřejné součty (žádné jednotlivé údaje); 5 minut
 * z mezipaměti CDN, ať otevření kanálu nezatěžuje databázi.
 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel') ?? '';
  if (!UUID.test(channel)) return NextResponse.json({ error: 'Neplatný kanál.' }, { status: 400 });
  // ?fresh=1 jde mimo mezipaměť CDN (desítka dotazů do databáze) - z jedné adresy
  // jen párkrát za minutu, jinak by šla databáze zasypat dokola.
  const fresh = req.nextUrl.searchParams.get('fresh') === '1';
  if (fresh && !allowRequest(`badge-stats-fresh:${clientIp(req.headers)}`, 20, 60_000)) return tooManyRequests(30);
  const { data: profile, error } = await supabaseServer.from('profiles').select('created_at').eq('id', channel).maybeSingle();
  if (error) return NextResponse.json({ error: 'Kanál se teď nepodařilo načíst.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  if (!profile) return NextResponse.json({ error: 'Kanál nenalezen.' }, { status: 404 });
  const stats = await badgeStatsFor(channel, (profile as { created_at?: string | null }).created_at ?? null);
  if (!stats) return NextResponse.json({ error: 'Čísla se teď nepodařilo spočítat.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  // Majitel na svém kanálu (?fresh=1) hned po přidělení / výběru odznaku - bez mezipaměti CDN.
  return NextResponse.json({ stats }, { headers: { 'Cache-Control': fresh ? 'private, no-store' : 'public, s-maxage=300, stale-while-revalidate=600' } });
}
