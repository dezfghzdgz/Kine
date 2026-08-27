import { supabase } from './supabaseClient';
import type { MusicTrack } from './musicPlayer';
import type { QueuedVideo } from './videoQueue';
import { isMusicVideo } from './playbackMode';

/**
 * Z čeho se skládá hudební fronta.
 *
 * Nová fronta se nezavádí. Ta z nabídky ⋮ je přesně to, co hudba potřebuje -
 * jen se v hudebním režimu ukáže vedle přehrávače místo pod ním. Když je
 * prázdná, poskládá se fronta z hudby, která se u videa nabízí vedle, ať
 * "další skladba" funguje i bez toho, aby si ji divák musel naklikat.
 */

/** Navázaný profil chodí ze Supabase jednou jako objekt a jindy jako pole. */
function creatorOf(video: any): string | null {
  const profiles = video?.profiles;
  if (Array.isArray(profiles)) return profiles[0]?.username ?? null;
  return profiles?.username ?? null;
}

export function trackFromVideo(video: any): MusicTrack | null {
  if (!video?.id || !video?.cloudflare_video_id) return null;
  return {
    id: video.id,
    cloudflareId: video.cloudflare_video_id,
    title: video.title ?? '',
    creator: creatorOf(video),
    thumbnail: video.thumbnail_url ?? null,
    duration: video.duration_seconds ?? null,
  };
}

function trackFromQueued(item: QueuedVideo): MusicTrack | null {
  if (!item.cloudflare_video_id) return null;
  return {
    id: item.id,
    cloudflareId: item.cloudflare_video_id,
    title: item.title,
    creator: item.username ?? null,
    thumbnail: item.thumbnail_url ?? null,
    duration: item.duration_seconds ?? null,
  };
}

/**
 * Doplní chybějící údaje u položek přidaných do fronty dřív, než hudba
 * vznikla - ty si cloudflare id neukládaly, takže by se neměly jak přehrát.
 */
async function fillMissing(items: QueuedVideo[]): Promise<Map<string, any>> {
  const missing = items.filter((item) => !item.cloudflare_video_id).map((item) => item.id);
  if (missing.length === 0) return new Map();

  const { data } = await supabase
    .from('videos')
    .select('id, title, thumbnail_url, duration_seconds, cloudflare_video_id, profiles!videos_owner_id_fkey(username)')
    .in('id', missing);

  return new Map((data ?? []).map((video: any) => [video.id, video]));
}

export async function buildMusicQueue(
  current: any,
  related: any[],
  queued: QueuedVideo[]
): Promise<MusicTrack[]> {
  const currentTrack = trackFromVideo(current);
  if (!currentTrack) return [];

  if (queued.length > 0) {
    const filled = await fillMissing(queued);

    const fromQueue = queued
      .map((item) => trackFromQueued(item) ?? trackFromVideo(filled.get(item.id)))
      .filter((track): track is MusicTrack => track !== null);

    // Právě hraná skladba patří do fronty, i když v ní sama není -
    // jinak by "další" nevědělo, odkud se odpíchnout.
    if (!fromQueue.some((track) => track.id === currentTrack.id)) {
      return [currentTrack, ...fromQueue];
    }
    return fromQueue;
  }

  const fromRelated = (related ?? [])
    .filter((video) => isMusicVideo(video))
    .map(trackFromVideo)
    .filter((track): track is MusicTrack => track !== null)
    .filter((track) => track.id !== currentTrack.id);

  return [currentTrack, ...fromRelated];
}
