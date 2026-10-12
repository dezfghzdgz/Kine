import { supabaseServer } from './supabaseServer';

/**
 * Údaje pro náhled odkazu na přenos (/live/<kanál>): kdo, jestli je živě,
 * název a snímek. Používá app/live/[id]/layout.tsx (titulek a popis)
 * a app/live/[id]/opengraph-image.tsx (obrázek). Zablokovaný nebo
 * shadow-banovaný kanál náhled nedostane (vrací null).
 */
export type LivePreview = {
  ownerId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  live: boolean;
  title: string;
  description: string;
  videoUid: string | null;
  /** Vlastní náhled přenosu (jen když je živě a není skrytý kontrolou obsahu). */
  thumbnailUrl: string | null;
  startedAt: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadLivePreview(ownerId: string): Promise<LivePreview | null> {
  if (!UUID.test(ownerId)) return null;
  try {
    const [{ data: profile }, { data: stream }] = await Promise.all([
      supabaseServer
        .from('profiles')
        .select('id, username, display_name, avatar_url, banner_url, is_banned, is_shadow_banned')
        .eq('id', ownerId)
        .maybeSingle(),
      // select('*'): sloupec kontroly obsahu (moderation_hidden_at) je jen s novou migrací.
      supabaseServer.from('live_streams').select('*').eq('owner_id', ownerId).maybeSingle(),
    ]);
    if (!profile || profile.is_banned || profile.is_shadow_banned) return null;
    return {
      ownerId,
      name: profile.display_name || profile.username || 'Kine',
      username: profile.username ?? '',
      avatarUrl: profile.avatar_url ?? null,
      bannerUrl: profile.banner_url ?? null,
      live: !!stream?.is_live,
      title: (stream?.title ?? '').trim(),
      description: (stream?.description ?? '').trim(),
      // Přenos skrytý kontrolou obsahu: v náhledu odkazu žádný snímek z vysílání.
      videoUid: stream?.is_live && !stream?.moderation_hidden_at ? stream?.current_video_uid ?? null : null,
      thumbnailUrl:
        stream?.is_live && !stream?.moderation_hidden_at && typeof stream?.thumbnail_url === 'string' && /^https:\/\//.test(stream.thumbnail_url)
          ? stream.thumbnail_url
          : null,
      startedAt: stream?.is_live ? stream?.started_at ?? null : null,
    };
  } catch {
    return null;
  }
}

/** Snímek běžícího přenosu od Cloudflare (videodelivery.net - bez kódu zákazníka). */
export function liveThumbnailUrl(videoUid: string, height = 720): string {
  return `https://videodelivery.net/${videoUid}/thumbnails/thumbnail.jpg?height=${height}`;
}
