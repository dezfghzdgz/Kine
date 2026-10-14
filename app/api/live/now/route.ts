import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, isStaffUser, userFromRequest } from '@/lib/apiUser';
import {
  LIST_SYNC_BUDGET_MS,
  diagnoseLiveRow,
  liveDecisionNote,
  liveSyncInfo,
  liveViewerCount,
  publicLive,
  syncLiveStreamsForViewers,
  type LiveStreamRow,
} from '@/lib/liveStream';
import { arrangeLiveNow, type LiveNowProfile, type LiveRestriction } from '@/lib/liveNow';
import { liveHiddenNow } from '@/lib/nudityRules';
import { runInBackground } from '@/lib/background';
import { secondsSince } from '@/lib/liveEvents';
import { appPingFresh } from '@/lib/liveSignal';

/** Proč přenos ostatní nevidí: kontrola obsahu (vidí majitel a tým Kine), zablokovaný účet, shadow-ban (jen tým Kine). */
type LiveHiddenReason = 'moderation' | LiveRestriction;

export const dynamic = 'force-dynamic';
// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, verification_tier';

/** Instance serveru (diagnostika: dvě odpovědi z různých instancí můžou vidět jiný stav srovnání). */
const INSTANCE = Math.random().toString(36).slice(2, 8);

/**
 * Profily kanálů, které vysílají. Dřív se braly vnořeným dotazem spolu
 * s přenosy - a když ten z jakéhokoli důvodu selhal (chybějící sloupec
 * v databázi, vztah, který PostgREST nenašel), vrátila se prázdná řada
 * "Živě", i když stránka přenosu fungovala. Teď zvlášť a se zálohou bez
 * sloupců o blokaci (pak se bere, že kanál zablokovaný není).
 */
async function loadProfiles(ids: string[]): Promise<Map<string, LiveNowProfile> | null> {
  const map = new Map<string, LiveNowProfile>();
  if (ids.length === 0) return map;
  const full = await supabaseServer.from('profiles').select(`${PROFILE_FIELDS}, is_banned, is_shadow_banned`).in('id', ids);
  let rows: LiveNowProfile[] | null = (full.data as LiveNowProfile[] | null) ?? null;
  if (full.error) {
    console.error('Kine: /api/live/now profily (se sloupci o blokaci)', full.error.message);
    const basic = await supabaseServer.from('profiles').select(PROFILE_FIELDS).in('id', ids);
    if (basic.error) {
      // Bez profilů nejde poznat, kdo je zablokovaný - radši žádná odpověď než prázdná řada.
      console.error('Kine: /api/live/now profily', basic.error.message);
      return null;
    }
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
  const value = await liveViewerCount(inputId).catch(() => null);
  viewersCache.set(inputId, { at: Date.now(), value });
  if (viewersCache.size > 500) {
    for (const [key, entry] of viewersCache) if (Date.now() - entry.at > VIEWERS_TTL_MS) viewersCache.delete(key);
  }
  return value;
}

/** Řádek přenosu pro diagnostiku (jen tým Kine): stav, stáří údajů a proč (ne)je v seznamu. */
function diagRow(row: LiveStreamRow, profile: LiveNowProfile | undefined, inList: boolean) {
  const r = row as LiveStreamRow & Record<string, any>;
  let why: string | null = null;
  if (row.is_live && !inList) {
    why = !profile ? 'no-profile' : profile.is_banned ? 'banned' : profile.is_shadow_banned ? 'shadow-ban' : liveHiddenNow(r) ? 'moderation' : 'over-limit';
  }
  const note = liveDecisionNote(row.owner_id);
  return {
    owner: row.owner_id,
    username: profile?.username ?? null,
    isLive: row.is_live,
    inList,
    why,
    video: row.current_video_uid,
    startedS: secondsSince(row.started_at),
    endedS: secondsSince(row.ended_at),
    appPingS: secondsSince(row.app_ping_at),
    appPingFresh: appPingFresh(row),
    confirmedS: secondsSince(row.cf_confirmed_at !== undefined ? row.cf_confirmed_at : row.checked_at),
    stoppedS: secondsSince(row.app_stopped_at),
    hiddenS: secondsSince(r.moderation_hidden_at),
    lastDecision: note ? { ...note, atS: secondsSince(note.at) } : null,
  };
}

/**
 * Kdo je teď živě (řada "Živě" na hlavní stránce a stránka /streams). Pořadí
 * a kdo se ukáže řeší lib/liveNow.ts: vlastní přenos první, pak odebírané
 * kanály, pak ostatní zamíchaní (malé kanály nezapadnou). Zablokované se
 * nevypisují, shadow-banované vidí jen jejich majitel; moderátoři a správci
 * vidí všechno s popiskem (hidden), proč to ostatní nevidí.
 *
 * ?limit=N (1-60, výchozí 24), ?viewers=1 přidá počty diváků (Cloudflare),
 * ?countOnly=1 vrátí jen počet (tečka u odkazu Živě v menu - bez přihlášení
 * jde z mezipaměti CDN, ať menu nezatěžuje server), ?diag=1 přidá týmu Kine
 * diagnostiku (proč přenos v seznamu je / není).
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const params = req.nextUrl.searchParams;
  const countOnly = params.get('countOnly') === '1';
  const withViewers = params.get('viewers') === '1';
  const wantsDiag = params.get('diag') === '1' && !countOnly;
  // Do mezipaměti CDN jen dotaz bez přihlášení s "anon=1" v adrese (lib/authHeaders.ts - cacheableUrl):
  // přihlášený má jinou adresu, takže mu CDN nikdy nevrátí seznam určený nepřihlášeným.
  const publicRequest = !req.headers.get('authorization') && params.get('anon') === '1';
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1 ? Math.min(60, Math.floor(limitRaw)) : 24;
  // Srovnání s Cloudflare běží na pozadí; seznam se nečeká (stav drží appka a srovnání - lib/liveStream.ts).
  await syncLiveStreamsForViewers(countOnly ? 0 : LIST_SYNC_BUDGET_MS);
  const syncMs = Date.now() - startedAt;
  const { data, error } = await supabaseServer
    .from('live_streams')
    .select('*')
    .eq('is_live', true)
    .order('started_at', { ascending: false })
    .limit(60);
  const noStore = { headers: { 'Cache-Control': 'no-store' } };
  if (isMissingTable(error)) return NextResponse.json(countOnly ? { enabled: false, count: 0 } : { enabled: false, streams: [] }, noStore);
  if (error) {
    // Výpadek databáze: chyba, ne prázdný seznam - stránka si nechá ten poslední
    // (dřív odpověď "nikdo nevysílá" a přenos na chvíli zmizel z řady Živě).
    console.error('Kine: /api/live/now', error.message);
    return NextResponse.json({ error: 'Seznam přenosů se teď nepodařilo načíst.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const viewer = req.headers.get('authorization') ? await userFromRequest(req) : null;
  const live = (data ?? []) as LiveStreamRow[];
  const ids = live.map((r) => r.owner_id);
  const [loadedProfiles, followed] = await Promise.all([
    loadProfiles(ids),
    (async () => {
      const set = new Set<string>();
      if (!viewer || ids.length === 0) return set;
      const { data: subs } = await supabaseServer.from('subscriptions').select('channel_id').eq('subscriber_id', viewer.id).in('channel_id', ids);
      for (const s of subs ?? []) set.add(s.channel_id as string);
      return set;
    })(),
  ]);
  if (!loadedProfiles) {
    return NextResponse.json({ error: 'Seznam přenosů se teď nepodařilo načíst.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const profiles = loadedProfiles;
  // Moderátoři a správci vidí v řadě i přenosy, které ostatní nevidí - s popiskem proč. Role se
  // zjišťuje jen když je co skrývat nebo když chtějí diagnostiku (seznam se obnovuje každých 20 s).
  const somethingHidden =
    live.some((r) => liveHiddenNow(r as any)) || [...profiles.values()].some((p) => p.is_banned || p.is_shadow_banned);
  const staff = viewer && !countOnly && (somethingHidden || wantsDiag) ? await isStaffUser(viewer.id) : false;
  // Přenos skrytý kontrolou obsahu (čeká na moderátora) vidí v řadě jen jeho majitel a tým Kine.
  // Skrytí platí jen pro přenos, při kterém vzniklo (lib/nudityRules.ts - liveHiddenNow).
  const rows = live.filter((r) => !liveHiddenNow(r as any) || r.owner_id === viewer?.id || staff);

  // Všechny viditelné (kvůli počtu), do seznamu jen prvních `limit`.
  const all = arrangeLiveNow(rows, profiles, { viewerId: viewer?.id ?? null, followed, limit: 60, staff }).map((entry) => ({
    ...entry,
    // Proč ho ostatní nevidí (popisek u karty) - jen pro majitele (kontrola obsahu) a tým Kine.
    hidden: (liveHiddenNow(entry.row as any) ? 'moderation' : entry.restricted) as LiveHiddenReason | null,
  }));
  // Kolik přenosů vidí každý (číslo u Živě v menu - stejné jako bez přihlášení).
  const publicCount = all.filter((e) => !e.hidden).length;
  if (countOnly) {
    return NextResponse.json(
      { enabled: true, count: publicCount },
      { headers: publicRequest ? { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=15', Vary: 'Authorization' } : { 'Cache-Control': 'private, no-store' } }
    );
  }
  const arranged = all.slice(0, limit);
  const settled = await Promise.all(
    arranged.map(async ({ row, profile, hidden }) => {
      try {
        return {
          ...(await publicLive(row)),
          followed: followed.has(row.owner_id),
          viewers: withViewers ? await cachedViewers(row.cf_input_id) : null,
          hidden,
          profile: { id: profile.id, username: profile.username, displayName: profile.display_name, avatarUrl: profile.avatar_url, verificationTier: profile.verification_tier },
        };
      } catch (e) {
        // Jeden rozbitý přenos nesmí shodit celý seznam.
        console.error('Kine: /api/live/now přenos', row.owner_id, (e as Error).message);
        return null;
      }
    })
  );
  const streams = settled.filter((s): s is NonNullable<typeof s> => !!s);

  // Diagnostika pro tým Kine: všechny živé řádky, nedávno skončené a vlastní přenos - a proč (ne)jsou v seznamu.
  let diag: Record<string, unknown> | undefined;
  if (wantsDiag && staff && viewer) {
    try {
      const inList = new Set(all.map((e) => e.row.owner_id));
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const recentQuery = await supabaseServer.from('live_streams').select('*').or(`ended_at.gt."${since}",owner_id.eq.${viewer.id}`).limit(20);
      const recent = ((recentQuery.data ?? []) as LiveStreamRow[]).filter((r) => !r.is_live);
      const extraIds = recent.map((r) => r.owner_id).filter((id) => !profiles.has(id));
      const extraProfiles = extraIds.length > 0 ? await loadProfiles(extraIds) : new Map<string, LiveNowProfile>();
      const profileOf = (id: string) => profiles.get(id) ?? extraProfiles?.get(id);
      const own = live.find((r) => r.owner_id === viewer.id) ?? recent.find((r) => r.owner_id === viewer.id) ?? null;
      diag = {
        at: new Date().toISOString(),
        instance: INSTANCE,
        viewer: viewer.id,
        ms: { sync: syncMs, total: Date.now() - startedAt },
        sync: liveSyncInfo(),
        rows: [...live, ...recent].map((r) => diagRow(r, profileOf(r.owner_id), inList.has(r.owner_id))),
        // Vlastní přenos: co o něm Cloudflare říká právě teď a co by srovnání udělalo.
        own: own ? { ...diagRow(own, profileOf(own.owner_id), inList.has(own.owner_id)), now: await diagnoseLiveRow(own) } : null,
      };
    } catch (e) {
      diag = { error: (e as Error).message };
    }
  }

  // Snímky z přenosů pro automatickou kontrolu obsahu (lib/nudityScan.ts) - na pozadí, až když je
  // odpověď hotová (kontrola chvíli vytíží procesor), a jen když někdo vysílá. Číslo v menu ji nespouští.
  if (live.length > 0) runInBackground(import('@/lib/nudityScan').then((m) => m.scanLiveStreams()), 'kontrola obsahu přenosů');

  // Bez přihlášení je seznam pro všechny stejný - pár vteřin ho podrží CDN (rychlejší hlavní
  // stránka a Živě, méně volání serveru). S přihlášením (vlastní přenos, odběry) vždy čerstvý.
  // Vary: Authorization - přihlášenému (vlastní přenos, odběry, skryté) se nesmí podstrčit odpověď pro nepřihlášené.
  const anonymous = publicRequest && !diag;
  return NextResponse.json(
    { enabled: true, streams, total: all.length, publicTotal: publicCount, ...(diag ? { diag } : {}) },
    {
      headers: {
        'Cache-Control': anonymous ? 'public, s-maxage=5, stale-while-revalidate=10' : 'private, no-store',
        ...(anonymous ? { Vary: 'Authorization' } : {}),
        'Server-Timing': `sync;dur=${syncMs}, total;dur=${Date.now() - startedAt}`,
      },
    }
  );
}
