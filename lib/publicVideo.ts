import { cache } from 'react';
import { supabaseServer } from './supabaseServer';

/**
 * Veřejné video pro server: náhledy odkazů, vložitelný přehrávač, oEmbed,
 * strukturovaná data. Vrací jen HOTOVÁ a VEŘEJNÁ videa - soukromé video a
 * video pro odběratele nesmí přes náhled odkazu prozradit ani název.
 *
 * `cache` z Reactu: v jednom požadavku se stejné video načte jednou, i když
 * si o něj řekne metadata i tělo stránky (app/watch/[id]/layout.tsx).
 */

export type PublicVideo = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  cloudflare_video_id: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  views: number | null;
  created_at: string;
  owner_id: string | null;
  made_for_kids: boolean | null;
  hashtags: string[] | null;
  owner: { username: string | null; display_name: string | null } | null;
};

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export const loadPublicVideo = cache(async (id: string): Promise<PublicVideo | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const { data } = await supabaseServer
      .from('videos')
      // Jeden doslovný řetězec, ne skládaný: Supabase z textu výběru odvozuje
      // typ řádku a ze skládaného odvodí "chybu" (na tom už jednou spadl build).
      .select('id, title, description, thumbnail_url, cloudflare_video_id, width, height, duration_seconds, views, created_at, owner_id, made_for_kids, hashtags, visibility, status, profiles!videos_owner_id_fkey(username, display_name)')
      .eq('id', id)
      .maybeSingle();

    if (!data || data.status !== 'ready' || data.visibility !== 'public') return null;
    const row = data as any;
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      thumbnail_url: row.thumbnail_url ?? null,
      cloudflare_video_id: row.cloudflare_video_id ?? null,
      width: row.width ?? null,
      height: row.height ?? null,
      duration_seconds: row.duration_seconds ?? null,
      views: row.views ?? null,
      created_at: row.created_at,
      owner_id: row.owner_id ?? null,
      made_for_kids: row.made_for_kids ?? null,
      hashtags: row.hashtags ?? null,
      owner: firstOf(row.profiles),
    };
  } catch {
    // Nesmyslné id nebo výpadek databáze nesmí shodit stránku.
    return null;
  }
});

export function creatorName(video: PublicVideo): string {
  return video.owner?.display_name || video.owner?.username || 'Kine';
}
