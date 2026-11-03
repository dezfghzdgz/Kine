'use client';

import { supabase } from './supabaseClient';
import { isSpark } from './videoBlocks';
import { sparkCandidateFilter } from './feedFilters';
import { preloadHls } from './hlsAttach';
import { customerCodeFromUrl, manifestUrl } from './streamSource';
import { sparkPoster } from './sparksPlayback';
import { playbackMode } from './netQuality';
import { rankSparks, type SparkRankContext } from './sparksRanking';
import { watchInfoFromRow, type WatchInfo } from './homeRecommendation';
import { loadHiddenContent, NOTHING_HIDDEN, type HiddenContent } from './hiddenContent';
import { seenLocally } from './upNext';
import { impressionsSnapshot } from './feedImpressions';
import { anonViewerKey, seededUnit, sessionSeed } from './seededRandom';

/**
 * Sparks dopředu: když je hlavní stránka načtená a prohlížeč nemá co dělat,
 * stáhne se seznam Sparks, seřadí se pro diváka (lib/sparksRanking.ts)
 * a připraví se první dva (náhled, přehrávač hls.js, seznam kvalit
 * u Cloudflare). Klepnutí na Sparks v menu pak nečeká na databázi ani na
 * první video - stránka má všechno po ruce.
 *
 * Šetrně: jen jednou za pár minut, v lehkém režimu (šetření dat, pomalé
 * připojení - lib/netQuality.ts) jen seznam a náhledy, žádné video.
 */

export const SPARK_FIELDS =
  'id, title, description, cloudflare_video_id, thumbnail_url, duration_seconds, width, height, created_at, scheduled_at, is_premiere, views, category, owner_id, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, verification_tier)';
/** Navíc kvalita (videos.engagement - supabase-migration-doporucovani-vykon.sql); bez migrace se jede bez ní. */
const SPARK_FIELDS_RANK = `${SPARK_FIELDS}, engagement`;
let withEngagement = true;
/** Kombinovaný filtr (vyšlo + krátké) v jednom dotazu; kdyby ho databáze nevzala, postaru. */
let combinedFilter = true;

/** Kolik kandidátů na jednu stránku Sparks (stránkuje se při dojetí ke konci). */
export const SPARKS_PAGE = 120;

/** Seznam z hlavní stránky platí tolik - pak se na stránce Sparks stáhne čerstvý. */
const FRESH_MS = 3 * 60 * 1000;
/** Kolik Sparks připravit dopředu. */
export const SPARKS_WARM_COUNT = 2;

export type SparkPage = { videos: any[]; more: boolean };

let cached: { at: number; page: SparkPage } | null = null;
let inflight: Promise<SparkPage | null> | null = null;

function missingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === '42703' || /column .* does not exist/i.test(error.message ?? ''));
}

/** Databáze (PostgREST) nerozuměla filtru - ne výpadek spojení. */
function filterNotUnderstood(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (error.code === 'PGRST100' || /pars(e|ing)|logic tree|unexpected/i.test(error.message ?? ''));
}

/**
 * Jedna stránka kandidátů na Sparks: jen krátká videa na výšku (do dvou
 * minut - délku a rozměry hlídá už databáze, ať se nestahují stovky dlouhých
 * videí, která by pak vypadla), od nejnovějšího. Dřív se bralo 80
 * nejnovějších videí jakéhokoli druhu a Sparks z nich často zbylo pár.
 * Null = chyba.
 */
export async function fetchSparkList(page = 0): Promise<SparkPage | null> {
  const nowIso = new Date().toISOString();
  const from = Math.max(0, page) * SPARKS_PAGE;
  const run = (fields: string) => {
    let q = supabase.from('videos').select(fields).eq('status', 'ready').eq('visibility', 'public');
    if (combinedFilter) {
      // Sparks hrají samy - premiéra se tu objeví až ve chvíli, kdy začne.
      q = q.not('width', 'is', null).not('height', 'is', null).or(sparkCandidateFilter(nowIso));
    } else {
      q = q.or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
    }
    return q
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + SPARKS_PAGE - 1);
  };
  let { data, error } = await run(withEngagement ? SPARK_FIELDS_RANK : SPARK_FIELDS);
  if (error && withEngagement && missingColumn(error)) {
    withEngagement = false;
    ({ data, error } = await run(SPARK_FIELDS));
  }
  if (error && combinedFilter && filterNotUnderstood(error)) {
    combinedFilter = false;
    ({ data, error } = await run(withEngagement ? SPARK_FIELDS_RANK : SPARK_FIELDS));
  }
  if (error) return null;
  const rows = (data ?? []) as any[];
  return { videos: rows.filter(isSpark), more: rows.length >= SPARKS_PAGE };
}

/** Seznam připravený z hlavní stránky (když je čerstvý), jinak null. */
export function takePrefetchedSparks(): SparkPage | null {
  if (!cached || Date.now() - cached.at > FRESH_MS) return null;
  return cached.page;
}

// --- Kdo se dívá (pro pořadí) ------------------------------------------------

export type SparkViewerContext = {
  userId: string | null;
  hidden: HiddenContent;
  watched: Map<string, WatchInfo>;
  subscribed: Set<string>;
};

const VIEWER_TTL_MS = 10 * 60 * 1000;
let viewerCache: { at: number; viewer: SparkViewerContext } | null = null;

/** Hlavní stránka už o divákovi všechno ví - Sparks si to vezmou odtud (bez dalších dotazů). */
export function rememberSparkViewer(viewer: SparkViewerContext): void {
  viewerCache = { at: Date.now(), viewer };
}

const SPARK_HISTORY_LIMIT = 300;

/**
 * Kdo se dívá: z hlavní stránky (když je čerstvé a stejný účet), jinak
 * dva malé dotazy souběžně se seznamem (schovaná + posledních 300 zhlédnutí).
 */
export async function loadSparkViewer(): Promise<SparkViewerContext> {
  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }) as any);
  const userId: string | null = data?.session?.user?.id ?? null;
  if (viewerCache && viewerCache.viewer.userId === userId && Date.now() - viewerCache.at < VIEWER_TTL_MS) return viewerCache.viewer;
  const empty: SparkViewerContext = { userId, hidden: NOTHING_HIDDEN, watched: new Map(), subscribed: new Set() };
  if (!userId) return empty;
  const [hidden, history] = await Promise.all([
    loadHiddenContent(userId).catch(() => NOTHING_HIDDEN),
    supabase
      .from('watch_history')
      .select('video_id, progress_seconds, completed, watched_at')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false })
      .limit(SPARK_HISTORY_LIMIT)
      .then((r) => r, () => ({ data: null })),
  ]);
  const watched = new Map<string, WatchInfo>();
  for (const row of ((history as any)?.data ?? []) as any[]) {
    if (row?.video_id && !watched.has(row.video_id)) watched.set(row.video_id, watchInfoFromRow(row));
  }
  const viewer: SparkViewerContext = { userId, hidden, watched, subscribed: new Set() };
  viewerCache = { at: Date.now(), viewer };
  return viewer;
}

/** Kontext pro pořadí: divák + co viděl v tomhle prohlížeči + semínko na ~30 minut. */
export function sparkRankContext(viewer: SparkViewerContext, now: number = Date.now()): SparkRankContext {
  const seed = sessionSeed(viewer.userId ?? anonViewerKey(), now);
  return {
    viewerId: viewer.userId,
    hidden: viewer.hidden,
    watched: viewer.watched,
    seenLocal: seenLocally(),
    impressions: impressionsSnapshot(),
    subscribed: viewer.subscribed,
    random: (id: string) => seededUnit(seed ^ 0x5a17, id),
    now,
  };
}

function warmImage(url: string | null) {
  if (!url || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

function warmManifest(video: any) {
  if (!video?.cloudflare_video_id) return;
  const url = manifestUrl(video.cloudflare_video_id, customerCodeFromUrl(video.thumbnail_url));
  // Stejně jako hls.js (CORS, bez cookies) - ať prohlížeč odpověď později použije.
  void fetch(url, { mode: 'cors', credentials: 'omit', priority: 'low' } as RequestInit).catch(() => undefined);
}

/**
 * Připraví Sparks dopředu (volá hlavní stránka, až je načtená). S `viewer`
 * (co o divákovi ví hlavní stránka) se první dva připraví přesně ty, které
 * stránka Sparks ukáže jako první.
 */
export function prefetchSparks(viewer?: SparkViewerContext): Promise<void> {
  if (viewer) rememberSparkViewer(viewer);
  const ready = takePrefetchedSparks();
  if (!ready && !inflight) {
    inflight = fetchSparkList(0)
      .then((page) => {
        if (page) cached = { at: Date.now(), page };
        return page;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  const pending: Promise<SparkPage | null> = ready ? Promise.resolve(ready) : inflight ?? Promise.resolve(null);
  return pending.then((page) => {
    if (!page || page.videos.length === 0) return;
    const ordered = viewer ? rankSparks(page.videos, sparkRankContext(viewer)) : page.videos;
    const light = playbackMode() === 'light';
    for (const video of ordered.slice(0, SPARKS_WARM_COUNT)) {
      warmImage(sparkPoster(video, light));
      if (!light) warmManifest(video);
    }
    if (!light) void preloadHls();
  });
}
