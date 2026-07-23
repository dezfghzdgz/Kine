'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import SparksCard from '@/components/SparksCard';
import CommentSection from '@/components/CommentSection';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useLanguage } from '@/lib/i18n';

function SparksPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const startId = searchParams.get('start');
  const [videos, setVideos] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const wheelLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [arrowsLeft, setArrowsLeft] = useState<number | null>(null);

  useEffect(() => {
    function updateArrowsPosition() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Video má max-width 460px a je uprostřed - šipky dáme kousek za jeho pravý okraj
      const videoRight = Math.min(rect.width, 460) / 2;
      const videoBasedLeft = rect.left + rect.width / 2 + videoRight + 16;

      if (commentsOpen && panelRef.current) {
        const panelRect = panelRef.current.getBoundingClientRect();
        // Když je panel otevřený, dáme šipky hned vedle něj (ne přes něj)
        setArrowsLeft(Math.min(videoBasedLeft, panelRect.left - 56));
      } else {
        setArrowsLeft(videoBasedLeft);
      }
    }

    updateArrowsPosition();
    window.addEventListener('resize', updateArrowsPosition);
    const timer = setTimeout(updateArrowsPosition, 300); // po dojetí animace panelu

    return () => {
      window.removeEventListener('resize', updateArrowsPosition);
      clearTimeout(timer);
    };
  }, [loading, commentsOpen]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const nowIso = new Date().toISOString();
    const { data } = await supabase
      .from('videos')
      .select('id, title, description, cloudflare_video_id, duration_seconds, width, height, created_at, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, verification_tier)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso},is_premiere.eq.true`)
      .limit(80);

    const sparks = (data ?? []).filter((v: any) => v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120);
    setVideos(sparks);

    if (startId) {
      const idx = sparks.findIndex((v: any) => v.id === startId);
      if (idx >= 0) setActiveIndex(idx);
    }

    setLoading(false);
  }

  useEffect(() => {
    if (videos.length === 0 || !startId) return;
    const idx = videos.findIndex((v) => v.id === startId);
    if (idx >= 0) {
      // Instantní skok na dané video, ať se stránka neotevře uprostřed animace
      requestAnimationFrame(() => {
        itemRefs.current[idx]?.scrollIntoView({ behavior: 'auto' });
      });
    }
  }, [videos, startId]);

  useEffect(() => {
    if (videos.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            setActiveIndex(idx);
          }
        });
      },
      { root: containerRef.current, threshold: [0.6] }
    );

    itemRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [videos]);

  if (loading) {
    return <p style={{ color: 'var(--text-faint)', padding: 20 }}>{t('loading')}</p>;
  }

  if (videos.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-faint)' }}>
        <p>{t('noSparksYet')}</p>
        <Link href="/upload" style={{ color: 'var(--text)' }}>Nahraj krátké vertikální video →</Link>
      </div>
    );
  }

  function scrollToIndex(i: number) {
    itemRefs.current[i]?.scrollIntoView({ behavior: 'smooth' });
  }

  function handleWheel(e: React.WheelEvent) {
    if (wheelLockRef.current) return;
    wheelLockRef.current = true;

    if (e.deltaY > 0 && activeIndex < videos.length - 1) {
      scrollToIndex(activeIndex + 1);
    } else if (e.deltaY < 0 && activeIndex > 0) {
      scrollToIndex(activeIndex - 1);
    }

    setTimeout(() => { wheelLockRef.current = false; }, 500);
  }

  return (
    <div style={{ height: '100%' }}>
      <div
        ref={containerRef}
        className="spark-feed"
        onWheel={handleWheel}
        style={{
          flex: '1',
          transform: commentsOpen ? 'translateX(-90px)' : 'translateX(0)',
          transition: 'transform 0.25s ease',
        }}
      >
        {videos.map((video, i) => (
          <div
            key={video.id}
            data-index={i}
            ref={(el) => { itemRefs.current[i] = el; }}
            className="spark-feed-item"
          >
            <SparksCard
              video={video}
              active={i === activeIndex}
              commentsOpen={commentsOpen}
              onToggleComments={() => setCommentsOpen((v) => !v)}
            />
          </div>
        ))}
      </div>

      <div className="spark-nav-arrows" style={arrowsLeft !== null ? { left: arrowsLeft } : undefined}>
        <button className="spark-nav-btn" onClick={() => scrollToIndex(activeIndex - 1)} disabled={activeIndex === 0}>
          ▲
        </button>
        <button className="spark-nav-btn" onClick={() => scrollToIndex(activeIndex + 1)} disabled={activeIndex === videos.length - 1}>
          ▼
        </button>
      </div>

      {videos[activeIndex] && (
        <div ref={panelRef} className={`spark-side-panel ${commentsOpen ? '' : 'spark-side-panel-hidden'}`}>
          <div className="panel" style={{ marginBottom: 16 }}>
            <p className="panel-heading">Creator Profile</p>
            <div className="creator-row">
              <div className="creator-avatar" style={{ overflow: 'hidden' }}>
                {videos[activeIndex].profiles?.avatar_url ? (
                  <img
                    src={videos[activeIndex].profiles.avatar_url}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : null}
              </div>
              <div>
                <Link href={`/channel/${videos[activeIndex].profiles?.id}`} className="creator-name">
                  {videos[activeIndex].profiles?.display_name ?? videos[activeIndex].profiles?.username}
                  <VerifiedBadge tier={videos[activeIndex].profiles?.verification_tier} />
                </Link>
              </div>
            </div>
          </div>

          <CommentSection
            videoId={videos[activeIndex].id}
            description={videos[activeIndex].description}
            ownerId={videos[activeIndex].profiles?.id}
          />
        </div>
      )}
    </div>
  );
}

export default function SparksPage() {
  return (
    <Suspense fallback={null}>
      <SparksPageInner />
    </Suspense>
  );
}
