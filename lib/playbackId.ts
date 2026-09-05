/**
 * Rozhodování o adrese přehrávače - čistá část bez prohlížeče a Supabase,
 * aby šla otestovat (tests/playbackId.test.mjs). Kdo ji volá, je
 * lib/playbackToken.ts.
 */

export type PlaybackVideo = {
  id: string;
  cloudflare_video_id: string;
  visibility?: string | null;
};

export type ResolvedPlayback = { id: string; expiresAt: number };

/** Kolik milisekund před vypršením se token už nepoužije. */
export const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/** Potřebuje video token? Veřejné ne; neznámá viditelnost se bere jako veřejná. */
export function needsPlaybackToken(video: PlaybackVideo): boolean {
  return !!video.visibility && video.visibility !== 'public';
}

/** Rozhodne z odpovědi serveru, co jde do adresy přehrávače. */
export function decidePlaybackId(
  video: PlaybackVideo,
  response: { token?: string | null; expiresAt?: number | null } | null,
  now = Date.now()
): ResolvedPlayback {
  const fallback = { id: video.cloudflare_video_id, expiresAt: Number.POSITIVE_INFINITY };
  if (!response || !response.token) return fallback;
  const expiresAt = typeof response.expiresAt === 'number' ? response.expiresAt : now + 60 * 60 * 1000;
  if (expiresAt - TOKEN_SAFETY_MARGIN_MS <= now) return fallback;
  return { id: response.token, expiresAt };
}

/** Je zapamatovaný token ještě k použití? */
export function cachedStillValid(cached: ResolvedPlayback | undefined, now = Date.now()): boolean {
  return !!cached && cached.expiresAt - TOKEN_SAFETY_MARGIN_MS > now;
}
