'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { buildVideoBlocks } from '@/lib/videoBlocks';
import { computeTrustRatingClient } from '@/lib/trustRatingClient';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';

type Tab = 'popular' | 'shorts' | 'surprise';

export default function ExplorePage() {
  const { t, lang } = useLanguage();
  const TAB_LABELS: Record<Tab, string> = {
    popular: lang === 'en' ? 'Popular' : 'Populární',
    shorts: 'Sparks',
    surprise: t('surprise'),
  };
  const [tab, setTab] = useState<Tab>('popular');
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [highCreditOnly, setHighCreditOnly] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const watchProgress = useWatchProgress(videos.map((v: any) => v.id));

  useEffect(() => {
    load();
  }, [tab, highCreditOnly]);

  async function load() {
    setLoading(true);
    const nowIso = new Date().toISOString();

    let query = supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, duration_seconds, width, height, profiles!videos_owner_id_fkey(id, username, created_at)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`);

    if (tab === 'shorts') {
      query = query.lte('duration_seconds', 120);
    }

    if (tab === 'popular') {
      query = query.order('views', { ascending: false });
    }

    const { data } = await query.limit(100);
    let results = data ?? [];

    if (tab === 'shorts') {
      results = results.filter((v: any) => v.height && v.width && v.height > v.width);
    }

    if (tab === 'surprise') {
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('channel_id')
          .eq('subscriber_id', authData.user.id);
        const { data: likes } = await supabase
          .from('video_reactions')
          .select('video_id')
          .eq('user_id', authData.user.id)
          .eq('reaction', 'like');

        const subscribedChannels = new Set((subs ?? []).map((s) => s.channel_id));
        const likedVideoIds = new Set((likes ?? []).map((l) => l.video_id));

        results = results.filter(
          (v: any) => !subscribedChannels.has(v.profiles?.id) && !likedVideoIds.has(v.id)
        );
      }
      // Zamíchat náhodně, ať jsou pokaždé jiná "překvapení"
      results = [...results].sort(() => Math.random() - 0.5);
    }

    if (highCreditOnly) {
      setFiltering(true);
      const uniqueOwners = new Map<string, string>();
      results.forEach((v: any) => {
        if (v.profiles?.id && v.profiles?.created_at) uniqueOwners.set(v.profiles.id, v.profiles.created_at);
      });

      const scores = await Promise.all(
        Array.from(uniqueOwners.entries()).map(async ([id, createdAt]) => [id, await computeTrustRatingClient(id, createdAt)] as const)
      );
      const highCreditIds = new Set(scores.filter(([, score]) => score >= 80).map(([id]) => id));
      results = results.filter((v: any) => highCreditIds.has(v.profiles?.id));
      setFiltering(false);
    }

    setVideos(results.slice(0, 48));
    setLoading(false);
  }

  return (
    <div>
      <p className="section-title">Explore</p>

      <div className="tab-row" style={{ marginBottom: 12 }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab-btn ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'popular' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: -14, marginBottom: 20 }}>
          {t('popularDesc')}
        </p>
      )}
      {tab === 'shorts' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: -14, marginBottom: 20 }}>
          {t('shortsDesc')}
        </p>
      )}
      {tab === 'surprise' && (
        <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: -14, marginBottom: 20 }}>
          {t('surpriseDesc')}
        </p>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>
      ) : videos.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('nothingHereYet')}</p>
      ) : tab === 'shorts' ? (
        <div className="shorts-grid">
          {videos.map((video: any) => (
            <Link href={`/sparks?start=${video.id}`} key={video.id} className="video-card">
              <div className="video-thumb video-thumb-vertical">
                {video.thumbnail_url ? (
                  <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
                ) : null}
                <div className="play-badge">▶</div>
                {watchProgress[video.id] > 3 && (
                  <div className="watch-progress-track">
                    <div className="watch-progress-fill" style={{ width: `${watchProgress[video.id]}%` }} />
                  </div>
                )}
              </div>
              <p className="video-card-title">{video.title}</p>
              <p className="video-card-meta">
                {video.profiles?.username ?? 'neznámý tvůrce'} · {video.views} {t('views')}
              </p>
            </Link>
          ))}
        </div>
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
                {watchProgress[video.id] > 3 && (
                  <div className="watch-progress-track">
                    <div className="watch-progress-fill" style={{ width: `${watchProgress[video.id]}%` }} />
                  </div>
                )}
                </div>
                <p className="video-card-title">{video.title}</p>
                <p className="video-card-meta">
                  {video.profiles?.username ?? 'neznámý tvůrce'} · {video.views} {t('views')}
                </p>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
