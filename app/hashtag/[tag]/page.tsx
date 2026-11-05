'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { buildVideoBlocks } from '@/lib/videoBlocks';
import { useLanguage } from '@/lib/i18n';
import { visibleNowFilter } from '@/lib/scheduling';
import { formatDuration } from '@/lib/homeRecommendation';
import VideoCard from '@/components/VideoCard';
import { VideoBlockRow } from '@/components/SparksShelf';
import GameChip from '@/components/GameChip';
import { gameFromTag } from '@/lib/games';
import { filterHidden, loadHiddenContent, NOTHING_HIDDEN } from '@/lib/hiddenContent';

/**
 * Videa s hashtagem. Stejné karty jako všude jinde (náhled po najetí,
 * délka, nabídka ⋮) a v jazyce diváka - dřív tu byly vlastní karty a
 * anglické popisky natvrdo. Naplánovaná videa, která ještě nejsou venku,
 * se neukazují.
 */
export default function HashtagPage() {
  const { t } = useLanguage();
  const params = useParams();
  const tag = decodeURIComponent(params.tag as string).toLowerCase();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  async function load() {
    setLoading(true);
    const [{ data }, hidden] = await Promise.all([
      supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, category, owner_id, cloudflare_video_id, created_at, scheduled_at, is_premiere, profiles!videos_owner_id_fkey(username, display_name, avatar_url)')
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .contains('hashtags', [tag])
        .or(visibleNowFilter())
        .order('created_at', { ascending: false })
        .limit(48),
      // "Nezajímá mě" / "Nedoporučovat kanál" platí i tady (seznam schovaných je sdílený, většinou bez dotazu).
      supabase.auth
        .getSession()
        .then(({ data: s }) => (s.session?.user?.id ? loadHiddenContent(s.session.user.id) : NOTHING_HIDDEN))
        .catch(() => NOTHING_HIDDEN),
    ]);
    setVideos(filterHidden(data ?? [], hidden));
    setLoading(false);
    document.title = `#${tag} - Kine`;
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  // Hashtag hry (#cs2, #minecraft): odkaz na stránku hry - tam jsou všechny její hashtagy a přenosy.
  const game = gameFromTag(tag);

  return (
    <div>
      <p className="section-title">#{tag}</p>
      {game && (
        <p className="hashtag-game-banner">
          <span>{t('gameHashtagBanner')}</span>
          <GameChip game={game} />
        </p>
      )}
      {videos.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('hashtagEmptyNote')}</p>
      ) : (
        buildVideoBlocks(videos).map((block, bi) => (
          <VideoBlockRow key={bi} type={block.type} style={{ marginBottom: 20 }}>
            {block.items.map((video: any) => (
              <VideoCard
                key={video.id}
                video={video}
                href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                isSparks={block.type === 'sparks'}
                formatDuration={formatDuration}
              />
            ))}
          </VideoBlockRow>
        ))
      )}
    </div>
  );
}
