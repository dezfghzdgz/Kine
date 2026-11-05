'use client';

import { customerCodeFromUrl, manifestUrl } from './streamSource';
import { previewsAllowed } from './netQuality';

/**
 * Příprava dalšího videa dopředu, ať se po kliknutí rozjede hned.
 *
 * Manifest HLS je malý textový soubor; když ho prohlížeč stáhne o chvíli
 * dřív (najetí na kartu, blížící se konec videa s automatickým
 * přehráváním), má ho Cloudflare připravený, než si o něj řekne přehrávač.
 * Každé video se ohřeje nejvýš jednou za návštěvu stránky a nikdy na
 * mobilních datech s úsporou (lib/netQuality.ts).
 */
const warmed = new Set<string>();
const MAX_WARMED = 300;

export function warmManifest(url: string, priority: 'high' | 'low' = 'high'): void {
  if (typeof window === 'undefined' || !url || warmed.has(url) || warmed.size >= MAX_WARMED) return;
  warmed.add(url);
  fetch(url, { mode: 'cors', credentials: 'omit', priority } as RequestInit)
    .then((r) => r.text())
    .catch(() => {
      // Nevadí - přehrávač si manifest stáhne sám.
    });
}

/** Manifest + náhled videa (najetí na položku „Další videa“ = hned; blížící se konec videa = v klidu, bez přednosti). */
export function warmVideo(video: { cloudflare_video_id?: string | null; playback_id?: string | null; thumbnail_url?: string | null } | null | undefined, priority: 'high' | 'low' = 'high'): void {
  if (!video || typeof window === 'undefined') return;
  try {
    if (!previewsAllowed()) return;
  } catch {
    return;
  }
  const id = video.playback_id ?? video.cloudflare_video_id;
  if (!id) return;
  warmManifest(manifestUrl(id, customerCodeFromUrl(video.thumbnail_url)), priority);
  if (video.thumbnail_url) {
    const img = new Image();
    img.decoding = 'async';
    img.src = video.thumbnail_url;
  }
}
