/**
 * Počítání zhlédnutí (app/api/videos/increment-view) - čistá logika bez
 * databáze (tests/apiHardening.test.mjs).
 */

/** Stejné video ze stejné adresy (IPv6: síť /64) se počítá nejvýš jednou za tolik. */
export const VIEW_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Okno zhlédnutí (číslo půlhodiny). Spolu s videem a adresou tvoří jedinečný
 * klíč záznamu v views_log - dva souběžné požadavky tak nezapíšou (a nepřičtou)
 * totéž zhlédnutí dvakrát; zapíše ho jen ten, komu projde vložení.
 */
export function viewSlot(now = Date.now()): number {
  return Math.floor(now / VIEW_COOLDOWN_MS);
}

type VideoLike = { status?: string | null; visibility?: string | null; scheduled_at?: string | null; moderation_hold?: string | null };

/**
 * Smí se zhlédnutí započítat? Jen hotové, zveřejněné (ne naplánované do
 * budoucna) a ne soukromé video, které neskryla kontrola obsahu. Video jen pro
 * odběratele potřebuje ještě ověřit, že ho divák opravdu vidí (`check: 'access'`).
 */
export function viewCountable(video: VideoLike | null | undefined, now = Date.now()): { ok: false } | { ok: true; check: 'none' | 'access' } {
  if (!video || video.status !== 'ready' || video.moderation_hold) return { ok: false };
  if (video.scheduled_at) {
    const at = Date.parse(video.scheduled_at);
    if (Number.isFinite(at) && at > now) return { ok: false };
  }
  if (video.visibility === 'public') return { ok: true, check: 'none' };
  if (video.visibility === 'private' || !video.visibility) return { ok: false };
  return { ok: true, check: 'access' };
}
