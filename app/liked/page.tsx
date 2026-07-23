'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';

export default function LikedPage() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ratingMode, setRatingMode] = useState<'stars' | 'like_dislike'>('like_dislike');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('rating_mode')
      .eq('id', authData.user.id)
      .single();
    const mode = (profile?.rating_mode as 'stars' | 'like_dislike') ?? 'like_dislike';
    setRatingMode(mode);

    // V režimu hvězdiček ukazujeme všechna ohodnocená videa (jakékoliv skóre),
    // v režimu lajk/dislike jen ta, co dostala lajk.
    let reactionsQuery = supabase
      .from('video_reactions')
      .select('video_id, score')
      .eq('user_id', authData.user.id);

    if (mode === 'like_dislike') {
      reactionsQuery = reactionsQuery.gte('score', 4);
    }

    const { data: reactions } = await reactionsQuery;
    const videoIds = (reactions ?? []).map((r) => r.video_id);

    if (videoIds.length === 0) {
      setVideos([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, profiles!videos_owner_id_fkey(username)')
      .in('id', videoIds)
      .eq('status', 'ready');

    const scoreByVideo = new Map((reactions ?? []).map((r) => [r.video_id, r.score]));
    const withScores = (data ?? []).map((v) => ({ ...v, myScore: scoreByVideo.get(v.id) }));

    setVideos(withScores);
    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  const filtered = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;
  const pageTitle = ratingMode === 'stars' ? 'Ohodnocená videa' : 'Líbí se mi';

  if (videos.length === 0) {
    return (
      <div className="auth-gate">
        <p>{pageTitle}</p>
        <p style={{ fontSize: 13 }}>
          {ratingMode === 'stars'
            ? 'Videa, která ohodnotíš hvězdičkami, se objeví tady.'
            : 'Videa, které si označíš 👍, se objeví tady.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="section-title">{pageTitle}</p>
      <div className="video-grid">
        {filtered.map((video: any) => (
          <Link href={`/watch/${video.id}`} key={video.id} className="video-card">
            <div className="video-thumb">
              {video.thumbnail_url ? (
                <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
              ) : null}
              <div className="play-badge">▶</div>
            </div>
            <p className="video-card-title">{video.title}</p>
            <p className="video-card-meta">
              {video.profiles?.username ?? 'neznámý tvůrce'} · {video.views} {t('views')}
              {ratingMode === 'stars' && video.myScore ? ` · tvoje hodnocení: ${video.myScore}★` : ''}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
