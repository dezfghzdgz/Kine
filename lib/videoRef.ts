/**
 * Odkaz na video, jak ho posílají appky: id videa na Kine (uuid), nebo id
 * u Cloudflare Stream (32 hex znaků).
 *
 * PROČ TO TU JE
 *
 * Mobilní Kine Clipper (Android, do verze 0.4.1) se po nahrání klipu ptal
 * na stav (/api/videos/status) s id od Cloudflare místo id na Kine. Kine
 * takové video v databázi nenašla (sloupec id je uuid), nikdo ho nepřepnul
 * na "ready" - a klip zůstal viset jako "zpracovává se": u Cloudflare byl,
 * na Kine nikde. Teď se přijme obojí, takže to spraví i už nainstalované
 * starší appky.
 *
 * Čistá logika (tests/videoRef.test.mjs).
 */

export const KINE_VIDEO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOUDFLARE_VIDEO_UID = /^[a-f0-9]{32}$/i;

export type VideoRef = { kind: 'kine'; id: string } | { kind: 'cloudflare'; uid: string };

/** Co je to za id (bez mezer okolo); null = ani jedno - do databáze se nic takového neposílá. */
export function videoRefFrom(value: unknown): VideoRef | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (KINE_VIDEO_ID.test(v)) return { kind: 'kine', id: v.toLowerCase() };
  if (CLOUDFLARE_VIDEO_UID.test(v)) return { kind: 'cloudflare', uid: v.toLowerCase() };
  return null;
}

/** Je to id videa na Kine (uuid)? Jiné hodnoty se do dotazu na sloupec id neposílají (databáze by hlásila chybu). */
export function isKineVideoId(value: unknown): value is string {
  return typeof value === 'string' && KINE_VIDEO_ID.test(value.trim());
}
