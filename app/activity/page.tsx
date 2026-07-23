'use client';

import { Suspense, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { buildVideoBlocks } from '@/lib/videoBlocks';

type Tab = 'rated' | 'history';

function ActivityPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [tab, setTab] = useState<Tab>('rated');
  const [ratingMode, setRatingMode] = useState<'stars' | 'like_dislike'>('like_dislike');
  const [ratedVideos, setRatedVideos] = useState<any[]>([]);
  const [historyVideos, setHistoryVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const watchProgress = useWatchProgress(ratedVideos.map((v) => v.id));

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLoading(false);
      return;
    }
    setUserId(authData.user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('rating_mode')
      .eq('id', authData.user.id)
      .single();
    const mode = (profile?.rating_mode as 'stars' | 'like_dislike') ?? 'like_dislike';
    setRatingMode(mode);

    let reactionsQuery = supabase
      .from('video_reactions')
      .select('video_id, score')
      .eq('user_id', authData.user.id);
    if (mode === 'like_dislike') reactionsQuery = reactionsQuery.gte('score', 4);

    const { data: reactions } = await reactionsQuery;
    const ratedIds = (reactions ?? []).map((r) => r.video_id);
    if (ratedIds.length > 0) {
      const { data } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, profiles!videos_owner_id_fkey(username)')
        .in('id', ratedIds)
        .eq('status', 'ready');
      const scoreByVideo = new Map((reactions ?? []).map((r) => [r.video_id, r.score]));
      setRatedVideos((data ?? []).map((v) => ({ ...v, myScore: scoreByVideo.get(v.id) })));
    }

    const { data: history } = await supabase
      .from('watch_history')
      .select('video_id, watched_at')
      .eq('user_id', authData.user.id)
      .order('watched_at', { ascending: false });
    const historyIds = (history ?? []).map((h) => h.video_id);
    if (historyIds.length > 0) {
      const { data: videoData } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, profiles!videos_owner_id_fkey(username)')
        .in('id', historyIds);
      const ordered = historyIds.map((id) => videoData?.find((v) => v.id === id)).filter(Boolean);
      setHistoryVideos(ordered as any[]);
    }

    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>Pro zobrazení aktivity se musíš nejdřív přihlásit.</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  const ratedLabel = ratingMode === 'stars' ? 'Ohodnocená videa' : 'Líbí se mi';
  const activeList = tab === 'rated' ? ratedVideos : historyVideos;
  const filtered = query ? activeList.filter((v) => v.title.toLowerCase().includes(query)) : activeList;

  return (
    <div>
      <p className="section-title">{t('yourActivityTitle')}</p>

      <div className="tab-row" style={{ marginBottom: 24 }}>
        <button className={`tab-btn ${tab === 'rated' ? 'active' : ''}`} onClick={() => setTab('rated')}>
          {ratedLabel}
        </button>
        <button className={`tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          Historie
        </button>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>
          {tab === 'rated'
            ? (ratingMode === 'stars' ? 'Videa, která ohodnotíš hvězdičkami, se objeví tady.' : 'Videa, které si označíš 👍, se objeví tady.')
            : 'Tady uvidíš videa, která jsi nedávno sledoval/a.'}
        </p>
      ) : (
        buildVideoBlocks(filtered).map((block, bi) => (
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
                  {video.profiles?.username ?? 'neznámý tvůrce'} · {video.views} {t('views')}
                  {tab === 'rated' && ratingMode === 'stars' && video.myScore ? ` · ${video.myScore}★` : ''}
                </p>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

export default function ActivityPage() {
  return (
    <Suspense fallback={null}>
      <ActivityPageInner />
    </Suspense>
  );
}
