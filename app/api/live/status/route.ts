import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
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
    supabaseServer.from('profiles').select('id, username, display_name, avatar_url, verification_tier, is_banned, is_shadow_banned').eq('id', channel).maybeSingle(),
  ]);
  const { is_banned: banned, is_shadow_banned: shadowBanned, ...publicProfile } = (profile ?? {}) as Record<string, any>;
  if (isMissingTable(error)) return NextResponse.json({ enabled: false, live: false, profile: profile ? publicProfile : null });
  if (!profile) return NextResponse.json({ error: 'Kanál nenalezen.' }, { status: 404 });
  // Zablokovaný kanál se jako živý neukazuje nikomu, shadow-banovaný jen
  // svému majiteli (stejně jako řada "Živě" na hlavní stránce).
  const hidden = !!banned || (!!shadowBanned && (await userFromRequest(req))?.id !== channel);
  if (!row || hidden) return NextResponse.json({ enabled: true, live: false, profile: publicProfile, stream: null }, { headers: { 'Cache-Control': 'no-store' } });
  const stream = await publicLive(row as LiveStreamRow);
  return NextResponse.json(
    { enabled: true, live: stream.live, profile: publicProfile, stream },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
