import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable } from '@/lib/apiUser';
import { publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';

export const dynamic = 'force-dynamic';

/**
 * Kdo je teď živě (řada "Živě" na hlavní stránce). Zablokované a
 * shadow-banované kanály se nevypisují.
 */
export async function GET() {
  await syncLiveStreams();
  const { data, error } = await supabaseServer
    .from('live_streams')
    .select('*, profiles!live_streams_owner_id_fkey(id, username, display_name, avatar_url, verification_tier, is_banned, is_shadow_banned)')
    .eq('is_live', true)
    .order('started_at', { ascending: false })
    .limit(24);
  if (isMissingTable(error)) return NextResponse.json({ enabled: false, streams: [] });
  if (error) return NextResponse.json({ enabled: true, streams: [] });

  const streams = [];
  for (const row of data ?? []) {
    const p = (row as any).profiles;
    if (!p || p.is_banned || p.is_shadow_banned) continue;
    streams.push({
      ...(await publicLive(row as LiveStreamRow)),
      profile: { id: p.id, username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url, verificationTier: p.verification_tier },
    });
  }
  return NextResponse.json({ enabled: true, streams }, { headers: { 'Cache-Control': 'no-store' } });
}
