'use client';

import { supabase } from './supabaseClient';
import { GAMES, countGames, type Game } from './games';

/** Všechny hashtagy všech her (jeden dotaz přes index na hashtagy). */
const ALL_TAGS = [...new Set(GAMES.flatMap((g) => g.tags))];

let cache: { at: number; list: { game: Game; count: number }[] } | null = null;
let pending: Promise<{ game: Game; count: number }[]> | null = null;

/**
 * Co se teď hraje: hry podle počtu veřejných videí za posledních 30 dní
 * (stránka /games, řada her v Explore). Jeden dotaz, v paměti 5 minut.
 * Při chybě prázdný seznam - stránka pak ukáže jen katalog.
 */
export function loadPopularGames(): Promise<{ game: Game; count: number }[]> {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return Promise.resolve(cache.list);
  if (pending) return pending;
  pending = (async () => {
    try {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from('videos')
        .select('hashtags, category')
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .gte('created_at', since)
        .overlaps('hashtags', ALL_TAGS)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) return [];
      const list = countGames((data ?? []) as { hashtags?: unknown; category?: string | null }[]);
      cache = { at: Date.now(), list };
      return list;
    } catch {
      return [];
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Hry, které přihlášený sleduje (tabulka game_follows); bez přihlášení / bez migrace prázdné. */
export async function loadFollowedGames(): Promise<string[]> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id;
    if (!uid) return [];
    const { data, error } = await supabase.from('game_follows').select('game, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(100);
    if (error) return [];
    return (data ?? []).map((r: { game: string }) => r.game).filter((slug) => GAMES.some((g) => g.slug === slug));
  } catch {
    return [];
  }
}
