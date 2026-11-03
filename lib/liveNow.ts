/**
 * Řada "Živě" na hlavní stránce - kdo se ukáže a v jakém pořadí. Čistá
 * logika bez databáze (tests/liveNow.test.mjs).
 *
 * Pořadí schválně není podle počtu diváků: na Twitchi tím malé kanály
 * mizí na konci seznamu a nikdo je nenajde. Tady:
 *   1. tvůj vlastní přenos (hned vidíš, že vysíláš),
 *   2. kanály, které odebíráš,
 *   3. ostatní v pořadí, které se každých 10 minut zamíchá - každý
 *      přenos se tak časem dostane dopředu.
 * Zablokované kanály se neukazují nikomu, shadow-banované jen majiteli.
 */

import { hashText, mixSeed } from './seededRandom';

export type LiveNowProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  verification_tier: string | null;
  is_banned?: boolean | null;
  is_shadow_banned?: boolean | null;
};

export const LIVE_NOW_SHUFFLE_MS = 10 * 60 * 1000;

// Otisk (FNV-1a) a promíchání s kolem (murmur3 fmix32) - na zamíchání bez náhody,
// která by skákala při každém obnovení. Stejné funkce používá doporučování (lib/seededRandom.ts).
const hash = hashText;
const mixWithSeed = mixSeed;

/**
 * Proč přenos ostatní nevidí (vidí ho jen tým Kine, popisek u karty):
 * zablokovaný účet, nebo shadow-ban. Majitel u svého shadow-banu popisek
 * nedostane - shadow-ban se nemá prozradit.
 */
export type LiveRestriction = 'banned' | 'shadow-ban';

export function arrangeLiveNow<T extends { owner_id: string; started_at: string | null }>(
  rows: T[],
  profiles: Map<string, LiveNowProfile>,
  options: { viewerId?: string | null; followed?: Set<string>; now?: number; limit?: number; staff?: boolean } = {}
): { row: T; profile: LiveNowProfile; restricted: LiveRestriction | null }[] {
  const viewerId = options.viewerId ?? null;
  const followed = options.followed ?? new Set<string>();
  const staff = !!options.staff;
  const seed = Math.floor((options.now ?? Date.now()) / LIVE_NOW_SHUFFLE_MS);
  const visible: { row: T; profile: LiveNowProfile; restricted: LiveRestriction | null; rank: number; mix: number; started: number }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.owner_id)) continue;
    seen.add(row.owner_id);
    const profile = profiles.get(row.owner_id);
    if (!profile) continue;
    const own = !!viewerId && row.owner_id === viewerId;
    let restricted: LiveRestriction | null = null;
    // Moderátoři a správci vidí i to, co ostatní ne - s popiskem proč (jinak by
    // nešlo poznat, proč je "Živě" prázdné, když appka hlásí, že se vysílá).
    if (profile.is_banned) {
      if (!staff) continue;
      restricted = 'banned';
    } else if (profile.is_shadow_banned && !own) {
      if (!staff) continue;
      restricted = 'shadow-ban';
    }
    const started = row.started_at ? new Date(row.started_at).getTime() : 0;
    visible.push({
      row,
      profile,
      restricted,
      rank: own ? 0 : followed.has(row.owner_id) ? 1 : 2,
      mix: mixWithSeed(hash(row.owner_id), seed),
      started: Number.isFinite(started) ? started : 0,
    });
  }
  visible.sort((a, b) => a.rank - b.rank || (a.rank < 2 ? b.started - a.started : a.mix - b.mix));
  return visible.slice(0, options.limit ?? 24).map(({ row, profile, restricted }) => ({ row, profile, restricted }));
}
