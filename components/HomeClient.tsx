'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import VideoCard from '@/components/VideoCard';
import { scoreVideo, buildBlocks, formatDuration, PAGE_SIZE, Block } from '@/lib/homeRecommendation';
import { loadHiddenContent, filterHidden } from '@/lib/hiddenContent';

export default function HomeClient({
  initialPool,
  initialBlocks,
  isEmpty,
}: {
  initialPool: any[];
  initialBlocks: Block[];
  isEmpty: boolean;
}) {
  const { t } = useLanguage();
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [scoredPool, setScoredPool] = useState<any[]>(initialPool);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [preference, setPreference] = useState<'short' | 'long'>('long');
  const [revealCount, setRevealCount] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(initialPool.length > PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    personalize();
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

  // Appka na serveru ukázala obecný pohled na videa (podle popularity a
  // čerstvosti). Teď appka zjistí, jestli je uživatel přihlášený - pokud
  // ano, natáhne si jeho odběry a historii a ten samý pool videí (žádné
  // nové natahování od Cloudflare/appky databáze appka jen re-seřadí)
  // přeskóruje na skutečně osobní pořadí.
  async function personalize() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    const subscribedIds = new Set<string>();
    const watchedIds = new Set<string>();
    const topCategories = new Set<string>();
    const topHashtags = new Set<string>();

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

    const currentPreference = (profile?.content_preference as 'short' | 'long') ?? 'long';
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

    const ctx = { subscribedIds, watchedIds, topCategories, topHashtags };

    // Co si divák schoval přes ⋮ ("Nezajímá mě" / "Nedoporučovat kanál"),
    // to se do doporučení vůbec nedostane.
    const hidden = await loadHiddenContent(authData.user.id);
    const visible = filterHidden(scoredPool, hidden);

    const resorted = [...visible].sort((a, b) => scoreVideo(b, ctx) - scoreVideo(a, ctx));
    setScoredPool(resorted);
    reveal(resorted, revealCount, currentPreference);

    const { data: history } = await supabase
      .from('watch_history')
      .select('video_id, progress_seconds')
      .eq('user_id', authData.user.id)
      .in('video_id', resorted.slice(0, revealCount).map((v: any) => v.id));

    if (history) {
      const next: Record<string, number> = {};
      for (const h of history) {
        const vid = resorted.find((v: any) => v.id === h.video_id);
        if (vid?.duration_seconds) {
          next[h.video_id] = Math.min(100, Math.round((h.progress_seconds / vid.duration_seconds) * 100));
        }
      }
      setProgressMap(next);
    }
  }

  function reveal(pool: any[], count: number, currentPreference: 'short' | 'long') {
    const combined = pool.slice(0, count);
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

  return (
    <div>
      {isEmpty ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-faint)' }}>
          <p>{t('noVideosYet')}</p>
          <Link href="/upload" style={{ color: 'var(--text)' }}>Nahraj první video →</Link>
        </div>
      ) : (
        <>
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
          {!hasMore && (
            <p style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '20px 0', fontSize: 13 }}>
              {t('thatsAllForNow')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
