'use client';

import { Suspense, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { buildVideoBlocks } from '@/lib/videoBlocks';

type Tab = 'liked' | 'disliked' | 'star5' | 'star4' | 'star3' | 'star2' | 'star1' | 'history';

function ActivityPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [ratingMode, setRatingMode] = useState<'stars' | 'like_dislike'>('like_dislike');
  const [tab, setTab] = useState<Tab>('liked');
  const [videosByScore, setVideosByScore] = useState<Record<number, any[]>>({});
  const [historyVideos, setHistoryVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

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
    setTab(mode === 'stars' ? 'star5' : 'liked');

    // Appka natáhne všechny reakce (líbí/nelíbí i všechny úrovně hvězd),
    // ne jen appku appku filtrovanou verzi - appky si je appka rozdělí
    // do jednotlivých skupin sama níž.
    const { data: reactions } = await supabase
      .from('video_reactions')
      .select('video_id, score')
      .eq('user_id', authData.user.id);

    const idsByScore: Record<number, string[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
    (reactions ?? []).forEach((r: any) => {
      const s = r.score ?? 3;
      if (idsByScore[s]) idsByScore[s].push(r.video_id);
    });

    const allRatedIds = Object.values(idsByScore).flat();
    if (allRatedIds.length > 0) {
      const { data } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, profiles!videos_owner_id_fkey(username)')
        .in('id', allRatedIds)
        .eq('status', 'ready');

      const byScore: Record<number, any[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (const score of [1, 2, 3, 4, 5]) {
        byScore[score] = idsByScore[score].map((id) => (data ?? []).find((v: any) => v.id === id)).filter(Boolean);
      }
      setVideosByScore(byScore);
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
      const ordered = (history ?? []).map((h) => {
        const v = videoData?.find((x) => x.id === h.video_id);
        return v ? { ...v, watched_at: h.watched_at } : null;
      }).filter(Boolean);
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

  const TABS: { key: Tab; label: string }[] =
    ratingMode === 'stars'
      ? [
          { key: 'star5', label: '5★' },
          { key: 'star4', label: '4★' },
          { key: 'star3', label: '3★' },
          { key: 'star2', label: '2★' },
          { key: 'star1', label: '1★' },
          { key: 'history', label: 'Historie' },
        ]
      : [
          { key: 'liked', label: '👍 Líbí se mi' },
          { key: 'disliked', label: '👎 Nelíbí se mi' },
          { key: 'history', label: 'Historie' },
        ];

  const activeList: any[] =
    tab === 'history' ? historyVideos
    : tab === 'liked' ? videosByScore[5] ?? []
    : tab === 'disliked' ? videosByScore[1] ?? []
    : videosByScore[Number(tab.replace('star', ''))] ?? [];

  const filtered = query ? activeList.filter((v) => v.title.toLowerCase().includes(query)) : activeList;

  function renderVideoGrid(list: any[]) {
    return buildVideoBlocks(list).map((block, bi) => (
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
            </p>
          </Link>
        ))}
      </div>
    ));
  }

  // Appka historii rozdělí podle dne sledování (Dnes / Včera / konkrétní
  // datum) - appka appka appka appka appka bez klikání do žádného
  // kalendáře, jen přehledně po dnech.
  function renderHistoryGroupedByDay(list: any[]) {
    const groups: { label: string; items: any[] }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

    for (const video of list) {
      const d = new Date(video.watched_at); d.setHours(0, 0, 0, 0);
      let label: string;
      if (d.getTime() === today.getTime()) label = 'Dnes';
      else if (d.getTime() === yesterday.getTime()) label = 'Včera';
      else label = new Date(video.watched_at).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });

      let group = groups.find((g) => g.label === label);
      if (!group) { group = { label, items: [] }; groups.push(group); }
      group.items.push(video);
    }

    return groups.map((g) => (
      <div key={g.label} style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 12 }}>{g.label}</p>
        {renderVideoGrid(g.items)}
      </div>
    ));
  }

  return (
    <div>
      <p className="section-title">{t('yourActivityTitle')}</p>

      <div className="tab-row" style={{ marginBottom: 24, flexWrap: 'wrap' }}>
        {TABS.map(({ key, label }) => (
          <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>
          {tab === 'history'
            ? 'Tady uvidíš videa, která jsi nedávno sledoval/a, rozdělená po dnech.'
            : 'Videa v této kategorii se objeví tady.'}
        </p>
      ) : tab === 'history' ? (
        renderHistoryGroupedByDay(filtered)
      ) : (
        renderVideoGrid(filtered)
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
