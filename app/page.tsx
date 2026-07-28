import { supabaseServer } from '@/lib/supabaseServer';
import { scoreVideo, buildBlocks, RECOMMENDATION_POOL_SIZE } from '@/lib/homeRecommendation';
import HomeClient from '@/components/HomeClient';

export const dynamic = 'force-dynamic';

// Appka tady na serveru rovnou spočítá první, obecný pohled na Home
// stránku (jen podle čerstvosti a popularity - appka na serveru zatím
// neví, kdo appku otevřel, protože přihlášení appka drží v prohlížeči,
// ne v cookies). Appka tak appce hned ukáže skutečný obsah, ne prázdnou
// stránku s "Načítám..." - a teprve poté appka v prohlížeči tichem
// dopočítá appku plnou, osobní verzi (appky odběry, historii sledování).
export default async function HomePage() {
  const nowIso = new Date().toISOString();

  const [{ data: candidates }, { data: shadowBanned }] = await Promise.all([
    supabaseServer
      .from('videos')
      .select('id, title, thumbnail_url, views, duration_seconds, width, height, created_at, category, hashtags, owner_id, cloudflare_video_id, profiles!videos_owner_id_fkey(username)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`)
      .order('created_at', { ascending: false })
      .limit(RECOMMENDATION_POOL_SIZE),
    supabaseServer.from('profiles').select('id').eq('is_shadow_banned', true),
  ]);

  const shadowBannedIds = new Set((shadowBanned ?? []).map((p: any) => p.id));
  const pool = (candidates ?? []).filter((v: any) => !shadowBannedIds.has(v.owner_id));

  const emptyCtx = { subscribedIds: new Set<string>(), watchedIds: new Set<string>(), topCategories: new Set<string>(), topHashtags: new Set<string>() };
  const sorted = [...pool].sort((a, b) => scoreVideo(b, emptyCtx) - scoreVideo(a, emptyCtx));

  const initialLong = sorted.filter((v: any) => !(v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120));
  const initialSparks = sorted.filter((v: any) => v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120);
  const initialBlocks = buildBlocks(initialLong, initialSparks, 'long');

  return <HomeClient initialPool={sorted} initialBlocks={initialBlocks} isEmpty={pool.length === 0} />;
}
