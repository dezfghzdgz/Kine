'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';
import VideoCard from '@/components/VideoCard';
import { scoreVideo, buildBlocks, formatDuration, PAGE_SIZE, RECOMMENDATION_POOL_SIZE, Block } from '@/lib/homeRecommendation';

export default function HomePage() {
  const { t } = useLanguage();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const [allVideosLoaded, setAllVideosLoaded] = useState<any[]>([]);
  const [scoredPool, setScoredPool] = useState<any[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [preference, setPreference] = useState<'short' | 'long'>('long');
  const [revealCount, setRevealCount] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadInitial();
  }, []);

  // Automatické donačítání - jakmile je "cílová značka" dole vidět na
  // obrazovce, appka potichu odhalí další dávku už spočítaných videí.
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, revealCount]);

  async function loadInitial() {
    const nowIso = new Date().toISOString();

    const { data: authData } = await supabase.auth.getUser();

    // Appka natáhne pool videí a seznam shadow-bannovaných rovnou, ať to
    // běží souběžně s dotazy na uživatelovy odběry/historii níž.
    const candidatesPromise = supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, duration_seconds, width, height, created_at, category, hashtags, owner_id, cloudflare_video_id, profiles!videos_owner_id_fkey(username)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`)
      .order('created_at', { ascending: false })
      .limit(RECOMMENDATION_POOL_SIZE);

    const shadowBannedPromise = supabase.from('profiles').select('id').eq('is_shadow_banned', true);

    // Appka si zjistí, co uživatel odebírá, co už sledoval, a jaké
    // kategorie/hashtagy ho v poslední době zajímaly - podle toho pak
    // videím spočítá skóre.
    const subscribedIds = new Set<string>();
    const watchedIds = new Set<string>();
    const topCategories = new Set<string>();
    const topHashtags = new Set<string>();
    let currentPreference: 'short' | 'long' = preference;

    if (authData.user) {
      const [{ data: profile }, { data: subs }, { data: watched }, { data: recentHistory }] = await Promise.all([
        supabase.from('profiles').select('content_preference').eq('id', authData.user.id).single(),
        supabase.from('subscriptions').select('channel_id').eq('subscriber_id', authData.user.id),
        supabase.from('watch_history').select('video_id').eq('user_id', authData.user.id),
        supabase
          .from('watch_history')
          .select('video_id, watched_at, videos(category, hashtags)')
          .eq('user_id', authData.user.id)
          .order('watched_at', { ascending: false })
          .limit(30),
      ]);

      currentPreference = (profile?.content_preference as 'short' | 'long') ?? 'long';
      setPreference(currentPreference);

      (subs ?? []).forEach((s: any) => subscribedIds.add(s.channel_id));
      (watched ?? []).forEach((w: any) => watchedIds.add(w.video_id));

      const categoryCounts: Record<string, number> = {};
      const hashtagCounts: Record<string, number> = {};
      (recentHistory ?? []).forEach((h: any) => {
        const cat = h.videos?.category;
        if (cat) categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
        (h.videos?.hashtags ?? []).forEach((tag: string) => {
          hashtagCounts[tag] = (hashtagCounts[tag] ?? 0) + 1;
        });
      });
      Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([c]) => topCategories.add(c));
      Object.entries(hashtagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([h]) => topHashtags.add(h));
    }

    const [{ data: candidates }, { data: shadowBanned }] = await Promise.all([candidatesPromise, shadowBannedPromise]);

    const shadowBannedIds = new Set((shadowBanned ?? []).map((p: any) => p.id));

    const pool = (candidates ?? []).filter((v: any) => !shadowBannedIds.has(v.owner_id));

    if (pool.length === 0) {
      setEmpty(true);
      return;
    }

    const ctx = { subscribedIds, watchedIds, topCategories, topHashtags };
    const sorted = [...pool].sort((a, b) => scoreVideo(b, ctx) - scoreVideo(a, ctx));

    setScoredPool(sorted);
    reveal(sorted, PAGE_SIZE, currentPreference);

    if (authData.user) {
      const { data: history } = await supabase
        .from('watch_history')
        .select('video_id, progress_seconds')
        .eq('user_id', authData.user.id)
        .in('video_id', sorted.slice(0, PAGE_SIZE).map((v: any) => v.id));

      if (history) {
        const next: Record<string, number> = {};
        for (const h of history) {
          const vid = sorted.find((v: any) => v.id === h.video_id);
          if (vid?.duration_seconds) {
            next[h.video_id] = Math.min(100, Math.round((h.progress_seconds / vid.duration_seconds) * 100));
          }
        }
        setProgressMap(next);
      }
    }
  }

  function reveal(pool: any[], count: number, currentPreference: 'short' | 'long') {
    const combined = pool.slice(0, count);
    setAllVideosLoaded(combined);
    setHasMore(count < pool.length);

    const sparksVideos = combined.filter((v: any) => v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120);
    const longVideos = combined.filter((v: any) => !(v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120));
    setBlocks(buildBlocks(longVideos, sparksVideos, currentPreference));
  }

  async function loadMore() {
    setLoadingMore(true);
    const nextCount = revealCount + PAGE_SIZE;
    reveal(scoredPool, nextCount, preference);
    setRevealCount(nextCount);
    setLoadingMore(false);
  }

  if (empty) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-faint)' }}>
        <p>{t('noVideosYet')}</p>
        <Link href="/upload" style={{ color: 'var(--text)' }}>Nahraj první video →</Link>
      </div>
    );
  }

  if (!blocks) {
    return (
      <div>
        <p className="section-title">{t('recommendedForYouHeading')}</p>
        <div className="video-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="video-card-skeleton">
              <div className="video-thumb skeleton-shimmer" />
              <div className="skeleton-line skeleton-shimmer" style={{ width: '85%' }} />
              <div className="skeleton-line skeleton-shimmer" style={{ width: '50%' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <OnboardingChecklist />
      <p className="section-title">{t('recommendedForYouHeading')}</p>

      {blocks.map((block, i) => (
        <div key={i} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 24 }}>
          {block.items.map((video: any) => (
            <VideoCard
              key={video.id}
              video={video}
              href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
              isSparks={block.type === 'sparks'}
              progressPercent={progressMap[video.id]}
              formatDuration={formatDuration}
            />
          ))}
        </div>
      ))}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {loadingMore && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0' }}>{t('loadingMore')}</p>
      )}
      {!hasMore && allVideosLoaded.length > 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0', fontSize: 13 }}>
          {t('thatsAllForNow')}
        </p>
      )}
    </div>
  );
}
