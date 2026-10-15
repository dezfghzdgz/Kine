'use client';

import { supabase } from './supabaseClient';
import { isSpark } from './videoBlocks';
import { preloadHls } from './hlsAttach';
import { customerCodeFromUrl, manifestUrl } from './streamSource';
import { sparkPoster } from './sparksPlayback';
import { playbackMode } from './netQuality';

/**
 * Sparks dopředu: když je hlavní stránka načtená a prohlížeč nemá co dělat,
 * stáhne se seznam Sparks a připraví se první dva (náhled, přehrávač hls.js,
 * seznam kvalit u Cloudflare). Klepnutí na Sparks v menu pak nečeká na
 * databázi ani na první video - stránka má všechno po ruce.
 *
 * Šetrně: jen jednou za pár minut, v lehkém režimu (šetření dat, pomalé
 * připojení - lib/netQuality.ts) jen seznam a náhledy, žádné video.
 */

export const SPARK_FIELDS =
  'id, title, description, cloudflare_video_id, thumbnail_url, duration_seconds, width, height, created_at, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, verification_tier)';

/** Seznam z hlavní stránky platí tolik - pak se na stránce Sparks stáhne čerstvý. */
const FRESH_MS = 3 * 60 * 1000;
/** Kolik Sparks připravit dopředu. */
export const SPARKS_WARM_COUNT = 2;

let cached: { at: number; videos: any[] } | null = null;
let inflight: Promise<any[] | null> | null = null;

/** Nejnovější veřejné Sparks (stejný dotaz jako stránka Sparks). Null = chyba. */
export async function fetchSparkList(): Promise<any[] | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('videos')
    .select(SPARK_FIELDS)
    .eq('status', 'ready')
    .eq('visibility', 'public')
    // Sparks hrají samy - premiéra se tu objeví až ve chvíli, kdy začne.
    .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) return null;
  return (data ?? []).filter(isSpark);
}

/** Seznam připravený z hlavní stránky (když je čerstvý), jinak null. */
export function takePrefetchedSparks(): any[] | null {
  if (!cached || Date.now() - cached.at > FRESH_MS) return null;
  return cached.videos;
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

/** Připraví Sparks dopředu (volá hlavní stránka, až je načtená). */
export function prefetchSparks(): Promise<void> {
  if (takePrefetchedSparks()) return Promise.resolve();
  if (!inflight) {
    inflight = fetchSparkList()
      .then((videos) => {
        if (videos) cached = { at: Date.now(), videos };
        return videos;
      })
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
  }
  return inflight.then((videos) => {
    if (!videos || videos.length === 0) return;
    const light = playbackMode() === 'light';
    for (const video of videos.slice(0, SPARKS_WARM_COUNT)) {
      warmImage(sparkPoster(video, light));
      if (!light) warmManifest(video);
    }
    if (!light) void preloadHls();
  });
}
