import { supabase } from './supabaseClient';
import {
  cachedStillValid,
  decidePlaybackId,
  needsPlaybackToken,
  type PlaybackVideo,
  type ResolvedPlayback,
} from './playbackId';

/**
 * Co patří do adresy přehrávače: u veřejného videa jeho id, u neveřejného
 * (soukromé, jen pro odběratele) podepsaný token z /api/videos/playback-token
 * (lib/streamProtection.ts). Když server token nedá - ochrana není
 * nastavená, nebo divák na video nemá právo - vrátí se id a přehrávač se
 * chová jako dřív.
 *
 * Token se pamatuje, ať se při návratu na stránku nechodí na server znovu.
 * Rozhodování bez prohlížeče je v lib/playbackId.ts a má test.
 */

const cache = new Map<string, ResolvedPlayback>();

export async function resolvePlaybackId(video: PlaybackVideo): Promise<string> {
  if (!needsPlaybackToken(video)) return video.cloudflare_video_id;

  const hit = cache.get(video.id);
  if (cachedStillValid(hit)) return hit!.id;

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    const res = await fetch('/api/videos/playback-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ videoId: video.id }),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    const decided = decidePlaybackId(video, body);
    // Náhradní id se nepamatuje - příště se zkusí znovu (třeba po přihlášení).
    if (decided.id !== video.cloudflare_video_id) cache.set(video.id, decided);
    return decided.id;
  } catch {
    return video.cloudflare_video_id;
  }
}

/** Zapomene tokeny - třeba po odhlášení. */
export function forgetPlaybackTokens() {
  cache.clear();
}
