'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { buildVideoBlocks } from '@/lib/videoBlocks';

export default function HashtagPage() {
  const params = useParams();
  const tag = (params.tag as string).toLowerCase();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [tag]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, width, height, duration_seconds, profiles!videos_owner_id_fkey(username)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .contains('hashtags', [tag])
      .order('created_at', { ascending: false })
      .limit(48);
    setVideos(data ?? []);
    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>Loading…</p>;

  return (
    <div>
      <p className="section-title">#{tag}</p>
      {videos.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>No videos with this hashtag yet.</p>
      ) : (
        buildVideoBlocks(videos).map((block, bi) => (
          <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
            {block.items.map((video: any) => (
              <Link
                href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                key={video.id}
                className="video-card"
              >
                <div className={block.type === 'sparks' ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
                  {video.thumbnail_url ? (
                    <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
                  ) : null}
                  <div className="play-badge">▶</div>
                </div>
                <p className="video-card-title">{video.title}</p>
                <p className="video-card-meta">
                  {video.profiles?.username ?? 'unknown creator'} · {video.views} views
                </p>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
