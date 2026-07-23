'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import OnboardingChecklist from '@/components/OnboardingChecklist';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';

const CHUNK_LONG = 4;
const CHUNK_SPARKS = 5;

function formatDuration(seconds: number | null) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type Block = { type: 'long' | 'sparks'; items: any[] };

function buildBlocks(longVideos: any[], sparksVideos: any[], preference: 'short' | 'long'): Block[] {
  const pattern: ('long' | 'sparks')[] =
    preference === 'short' ? ['sparks', 'sparks', 'long'] : ['long', 'long', 'sparks'];

  const blocks: Block[] = [];
  let longIndex = 0;
  let sparksIndex = 0;
  let patternIndex = 0;

  while (longIndex < longVideos.length || sparksIndex < sparksVideos.length) {
    const type = pattern[patternIndex % pattern.length];
    patternIndex++;

    if (type === 'long') {
      const items = longVideos.slice(longIndex, longIndex + CHUNK_LONG);
      longIndex += CHUNK_LONG;
      if (items.length > 0) blocks.push({ type: 'long', items });
    } else {
      const items = sparksVideos.slice(sparksIndex, sparksIndex + CHUNK_SPARKS);
      sparksIndex += CHUNK_SPARKS;
      if (items.length > 0) blocks.push({ type: 'sparks', items });
    }

    // Pojistka proti nekonečné smyčce, kdyby jedna fronta byla prázdná
    if (longIndex >= longVideos.length && sparksIndex >= sparksVideos.length) break;
  }

  return blocks;
}

const PAGE_SIZE = 40;

export default function HomePage() {
  const { t } = useLanguage();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [empty, setEmpty] = useState(false);
  const [allVideosLoaded, setAllVideosLoaded] = useState<any[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [preference, setPreference] = useState<'short' | 'long'>('long');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load(0, true);
  }, []);

  // Automatické donačítání - jakmile je "cílová značka" dole vidět na
  // obrazovce, appka potichu natáhne další dávku videí.
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
  }, [hasMore, loadingMore, page]);

  async function load(pageToLoad: number, isFirstLoad: boolean) {
    const nowIso = new Date().toISOString();
    const from = pageToLoad * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: newVideos } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, duration_seconds, width, height, created_at, profiles!videos_owner_id_fkey(username)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`)
      .order('created_at', { ascending: false })
      .range(from, to);

    const batch = newVideos ?? [];
    setHasMore(batch.length === PAGE_SIZE);

    if (isFirstLoad && batch.length === 0) {
      setEmpty(true);
      return;
    }

    // Rozkoukanost videí (pro tu červenou čárku na náhledu, jako appka appku appku YouTube) -
    // ukládá se appka appku appku appku appka appku appku appku databázi appku appku,
    // takže appku appku appku appku funguje appku appku appku appku zařízení appku.
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user && batch.length > 0) {
      const { data: history } = await supabase
        .from('watch_history')
        .select('video_id, progress_seconds')
        .eq('user_id', authData.user.id)
        .in('video_id', batch.map((v: any) => v.id));

      if (history) {
        setProgressMap((prev) => {
          const next = { ...prev };
          for (const h of history) {
            const vid = batch.find((v: any) => v.id === h.video_id);
            if (vid?.duration_seconds) {
              next[h.video_id] = Math.min(100, Math.round((h.progress_seconds / vid.duration_seconds) * 100));
            }
          }
          return next;
        });
      }
    }

    let currentPreference = preference;
    if (isFirstLoad) {
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('content_preference')
          .eq('id', authData.user.id)
          .single();
        currentPreference = (profile?.content_preference as 'short' | 'long') ?? 'long';
        setPreference(currentPreference);
      }
    }

    setAllVideosLoaded((prev) => {
      const combined = isFirstLoad ? batch : [...prev, ...batch];
      const sparksVideos = combined.filter((v: any) => v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120);
      const longVideos = combined.filter((v: any) => !(v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120));
      setBlocks(buildBlocks(longVideos, sparksVideos, currentPreference));
      return combined;
    });
  }

  async function loadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    await load(nextPage, false);
    setPage(nextPage);
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
    return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  }

  return (
    <div>
      <OnboardingChecklist />
      <p className="section-title">{t('latest')}</p>

      {blocks.map((block, i) => (
        <div key={i} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 24 }}>
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
                {progressMap[video.id] > 3 && (
                  <div className="watch-progress-track">
                    <div className="watch-progress-fill" style={{ width: `${progressMap[video.id]}%` }} />
                  </div>
                )}
                {video.duration_seconds ? (
                  <span className="video-duration">{formatDuration(video.duration_seconds)}</span>
                ) : null}
              </div>
              <p className="video-card-title">{video.title}</p>
              <p className="video-card-meta">
                {video.profiles?.username ?? 'neznámý tvůrce'} · {video.views} {t('views')}
              </p>
            </Link>
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
