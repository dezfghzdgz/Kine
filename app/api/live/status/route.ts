import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable } from '@/lib/apiUser';
import { publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Je kanál živě? Stránka přenosu (/live/[id]) a odznak na kanálu se ptají
 * odsud. Stav se srovná s Cloudflare (nejvýš jednou za pár vteřin pro
 * všechny kanály naráz - lib/liveStream.ts).
 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel') ?? '';
  if (!UUID.test(channel)) return NextResponse.json({ error: 'Neplatný kanál.' }, { status: 400 });

  await syncLiveStreams();
  const [{ data: row, error }, { data: profile }] = await Promise.all([
    supabaseServer.from('live_streams').select('*').eq('owner_id', channel).maybeSingle(),
    supabaseServer.from('profiles').select('id, username, display_name, avatar_url, verification_tier').eq('id', channel).maybeSingle(),
  ]);
  if (isMissingTable(error)) return NextResponse.json({ enabled: false, live: false, profile: profile ?? null });
  if (!profile) return NextResponse.json({ error: 'Kanál nenalezen.' }, { status: 404 });
  if (!row) return NextResponse.json({ enabled: true, live: false, profile, stream: null });
  const stream = await publicLive(row as LiveStreamRow);
  return NextResponse.json(
    { enabled: true, live: stream.live, profile, stream },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
