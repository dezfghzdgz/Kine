import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';
import { arrangeLiveNow, type LiveNowProfile } from '@/lib/liveNow';

export const dynamic = 'force-dynamic';

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, verification_tier';

/**
 * Profily kanálů, které vysílají. Dřív se braly vnořeným dotazem spolu
 * s přenosy - a když ten z jakéhokoli důvodu selhal (chybějící sloupec
 * v databázi, vztah, který PostgREST nenašel), vrátila se prázdná řada
 * "Živě", i když stránka přenosu fungovala. Teď zvlášť a se zálohou bez
 * sloupců o blokaci (pak se bere, že kanál zablokovaný není).
 */
async function loadProfiles(ids: string[]): Promise<Map<string, LiveNowProfile>> {
  const map = new Map<string, LiveNowProfile>();
  if (ids.length === 0) return map;
  const full = await supabaseServer.from('profiles').select(`${PROFILE_FIELDS}, is_banned, is_shadow_banned`).in('id', ids);
  let rows: LiveNowProfile[] | null = (full.data as LiveNowProfile[] | null) ?? null;
  if (full.error) {
    console.error('Kine: /api/live/now profily (se sloupci o blokaci)', full.error.message);
    const basic = await supabaseServer.from('profiles').select(PROFILE_FIELDS).in('id', ids);
    if (basic.error) console.error('Kine: /api/live/now profily', basic.error.message);
    rows = (basic.data as LiveNowProfile[] | null) ?? null;
  }
  for (const p of rows ?? []) map.set(p.id, p);
  return map;
}

/**
 * Kdo je teď živě (řada "Živě" na hlavní stránce). Pořadí a kdo se ukáže
 * řeší lib/liveNow.ts: vlastní přenos první, pak odebírané kanály, pak
 * ostatní zamíchaní (malé kanály nezapadnou). Zablokované se nevypisují,
 * shadow-banované vidí jen jejich majitel.
 */
export async function GET(req: NextRequest) {
  await syncLiveStreams();
  const { data, error } = await supabaseServer
    .from('live_streams')
    .select('*')
    .eq('is_live', true)
    .order('started_at', { ascending: false })
    .limit(60);
  if (isMissingTable(error)) return NextResponse.json({ enabled: false, streams: [] });
  if (error) {
    console.error('Kine: /api/live/now', error.message);
    return NextResponse.json({ enabled: true, streams: [] });
  }

  const rows = (data ?? []) as LiveStreamRow[];
  const ids = rows.map((r) => r.owner_id);
  const viewer = req.headers.get('authorization') ? await userFromRequest(req) : null;
  const [profiles, followed] = await Promise.all([
    loadProfiles(ids),
    (async () => {
      const set = new Set<string>();
      if (!viewer || ids.length === 0) return set;
      const { data: subs } = await supabaseServer.from('subscriptions').select('channel_id').eq('subscriber_id', viewer.id).in('channel_id', ids);
      for (const s of subs ?? []) set.add(s.channel_id as string);
      return set;
    })(),
  ]);

  const streams = [];
  for (const { row, profile } of arrangeLiveNow(rows, profiles, { viewerId: viewer?.id ?? null, followed })) {
    streams.push({
      ...(await publicLive(row)),
      followed: followed.has(row.owner_id),
      profile: { id: profile.id, username: profile.username, displayName: profile.display_name, avatarUrl: profile.avatar_url, verificationTier: profile.verification_tier },
    });
  }
  return NextResponse.json({ enabled: true, streams }, { headers: { 'Cache-Control': 'no-store' } });
}
