import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { liveViewerCount, publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';
import { arrangeLiveNow, type LiveNowProfile } from '@/lib/liveNow';
import { runInBackground } from '@/lib/background';

export const dynamic = 'force-dynamic';
// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

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

/** Počty diváků od Cloudflare si server chvíli pamatuje - stránka Živě se obnovuje každých 20 s. */
const VIEWERS_TTL_MS = 30 * 1000;
const viewersCache = new Map<string, { at: number; value: number | null }>();

async function cachedViewers(inputId: string | null): Promise<number | null> {
  if (!inputId) return null;
  const hit = viewersCache.get(inputId);
  if (hit && Date.now() - hit.at < VIEWERS_TTL_MS) return hit.value;
  const value = await liveViewerCount(inputId);
  viewersCache.set(inputId, { at: Date.now(), value });
  if (viewersCache.size > 500) {
    for (const [key, entry] of viewersCache) if (Date.now() - entry.at > VIEWERS_TTL_MS) viewersCache.delete(key);
  }
  return value;
}

/**
 * Kdo je teď živě (řada "Živě" na hlavní stránce a stránka /streams). Pořadí
 * a kdo se ukáže řeší lib/liveNow.ts: vlastní přenos první, pak odebírané
 * kanály, pak ostatní zamíchaní (malé kanály nezapadnou). Zablokované se
 * nevypisují, shadow-banované vidí jen jejich majitel.
 *
 * ?limit=N (1-60, výchozí 24), ?viewers=1 přidá počty diváků (Cloudflare),
 * ?countOnly=1 vrátí jen počet (tečka u odkazu Živě v menu - bez přihlášení
 * jde z mezipaměti CDN, ať menu nezatěžuje server).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const countOnly = params.get('countOnly') === '1';
  const withViewers = params.get('viewers') === '1';
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(60, Math.floor(limitRaw)) : 24;
  await syncLiveStreams();
  const { data, error } = await supabaseServer
    .from('live_streams')
    .select('*')
    .eq('is_live', true)
    .order('started_at', { ascending: false })
    .limit(60);
  const noStore = { headers: { 'Cache-Control': 'no-store' } };
  if (isMissingTable(error)) return NextResponse.json(countOnly ? { enabled: false, count: 0 } : { enabled: false, streams: [] }, noStore);
  if (error) {
    console.error('Kine: /api/live/now', error.message);
    return NextResponse.json(countOnly ? { enabled: true, count: 0 } : { enabled: true, streams: [] }, noStore);
  }

  // Snímky z přenosů pro automatickou kontrolu obsahu (lib/nudityScan.ts) - na pozadí, nejvýš jednou za chvíli.
  runInBackground(import('@/lib/nudityScan').then((m) => m.scanLiveStreams()), 'kontrola obsahu přenosů');

  const viewer = req.headers.get('authorization') ? await userFromRequest(req) : null;
  // Přenos skrytý kontrolou obsahu (čeká na moderátora) vidí v řadě jen jeho majitel.
  const rows = ((data ?? []) as LiveStreamRow[]).filter((r) => !(r as any).moderation_hidden_at || r.owner_id === viewer?.id);
  const ids = rows.map((r) => r.owner_id);
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

  const arranged = arrangeLiveNow(rows, profiles, { viewerId: viewer?.id ?? null, followed, limit: countOnly ? 60 : limit });
  if (countOnly) {
    return NextResponse.json(
      { enabled: true, count: arranged.length },
      { headers: { 'Cache-Control': viewer ? 'private, no-store' : 'public, s-maxage=30, stale-while-revalidate=60' } }
    );
  }
  const streams = await Promise.all(
    arranged.map(async ({ row, profile }) => ({
      ...(await publicLive(row)),
      followed: followed.has(row.owner_id),
      viewers: withViewers ? await cachedViewers(row.cf_input_id) : null,
      profile: { id: profile.id, username: profile.username, displayName: profile.display_name, avatarUrl: profile.avatar_url, verificationTier: profile.verification_tier },
    }))
  );
  return NextResponse.json({ enabled: true, streams }, { headers: { 'Cache-Control': 'no-store' } });
}
