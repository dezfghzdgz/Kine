/**
 * Viditelnost videa při skrytí kontrolou obsahu a při spolupráci - čistá
 * logika bez databáze (tests/apiHardening.test.mjs).
 *
 * PROČ: video, které čeká na potvrzení spolutvůrců, drží appka soukromé a
 * chtěnou viditelnost si pamatuje v pending_collab_visibility. Server ji po
 * poslední odpovědi vrátil (service role) - a to i u videa, které mezitím
 * skryla kontrola obsahu nebo moderátor. Stačilo si do sloupce zapsat
 * "public", pozvat druhý účet a ten pozvánku odmítnout: skryté porno bylo
 * zase veřejné. Teď:
 *   - skrytí (kontrola obsahu, moderátor) čekající viditelnost zruší a schová
 *     ji jako tu, která se vrátí po schválení,
 *   - odpověď spolutvůrce u skrytého videa viditelnost nevrací,
 *   - po schválení moderátorem se video, na které spolutvůrci pořád čekají,
 *     vrátí do čekání (soukromé, s chtěnou viditelností v pending_collab_visibility).
 */

export const VIDEO_VISIBILITIES = ['public', 'subscribers', 'private'] as const;
export type VideoVisibility = (typeof VIDEO_VISIBILITIES)[number];

export function isVideoVisibility(value: unknown): value is VideoVisibility {
  return typeof value === 'string' && (VIDEO_VISIBILITIES as readonly string[]).includes(value);
}

type VideoLike = {
  visibility?: string | null;
  pending_collab_visibility?: string | null;
  moderation_prev_visibility?: string | null;
};

/**
 * Viditelnost, která se má vrátit po schválení (moderation_prev_visibility) -
 * zapisuje se ve chvíli skrytí. Video čekající na spolutvůrce (soukromé
 * s chtěnou viditelností) si pamatuje tu chtěnou.
 */
export function visibilityBeforeHold(video: VideoLike): string {
  if (video.visibility === 'private' && isVideoVisibility(video.pending_collab_visibility)) return video.pending_collab_visibility;
  return video.visibility || 'public';
}

/** Co udělat po poslední odpovědi spolutvůrce: vrátit viditelnost, jen zahodit čekající hodnotu, nebo nic. */
export function collabRelease(video: VideoLike & { moderation_hold?: string | null }): { action: 'none' } | { action: 'clear' } | { action: 'release'; visibility: VideoVisibility } {
  const pending = video.pending_collab_visibility;
  if (pending === null || pending === undefined || pending === '') return { action: 'none' };
  // Skryté kontrolou obsahu: viditelnost vrací jen moderátor (schválením), čekající hodnota pryč.
  if (video.moderation_hold) return { action: 'clear' };
  // Nesmysl ve sloupci (zapisuje ho prohlížeč) se nikam nezapíše.
  if (!isVideoVisibility(pending)) return { action: 'clear' };
  return { action: 'release', visibility: pending };
}

/**
 * Schválení moderátorem: kam vrátit viditelnost. Když na video pořád čeká
 * některý spolutvůrce, zůstane soukromé a chtěná viditelnost se vrátí do
 * pending_collab_visibility (pustí ji poslední odpověď spolutvůrce).
 */
export function visibilityAfterApproval(video: VideoLike, pendingCollaborators: number): { visibility: string; pendingCollab: string | null } {
  const restore = video.moderation_prev_visibility || 'public';
  if (pendingCollaborators > 0 && restore !== 'private') return { visibility: 'private', pendingCollab: restore };
  return { visibility: restore, pendingCollab: null };
}
