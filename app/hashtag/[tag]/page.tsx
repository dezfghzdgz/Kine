'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { buildVideoBlocks } from '@/lib/videoBlocks';
import { useLanguage } from '@/lib/i18n';
import { visibleNowFilter } from '@/lib/scheduling';
import { formatDuration } from '@/lib/homeRecommendation';
import VideoCard from '@/components/VideoCard';

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
    const { data } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, width, height, duration_seconds, category, owner_id, cloudflare_video_id, created_at, scheduled_at, is_premiere, profiles!videos_owner_id_fkey(username)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .contains('hashtags', [tag])
      .or(visibleNowFilter())
      .order('created_at', { ascending: false })
      .limit(48);
    setVideos(data ?? []);
    setLoading(false);
    document.title = `#${tag} - Kine`;
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  return (
    <div>
      <p className="section-title">#{tag}</p>
      {videos.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('hashtagEmptyNote')}</p>
      ) : (
        buildVideoBlocks(videos).map((block, bi) => (
          <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
            {block.items.map((video: any) => (
              <VideoCard
                key={video.id}
                video={video}
                href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                isSparks={block.type === 'sparks'}
                formatDuration={formatDuration}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
