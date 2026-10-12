'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import SparksCard, { type SparkViewer } from '@/components/SparksCard';
import CommentSection from '@/components/CommentSection';
import VerifiedBadge from '@/components/VerifiedBadge';
import { useLanguage } from '@/lib/i18n';
import { isSpark } from '@/lib/videoBlocks';
import LoadFailed from '@/components/LoadFailed';
import { canPlayVodNatively } from '@/lib/vodPlayer';
import { chooseEngine } from '@/lib/vodPlayerCore';
import { preloadHls, supportsNativeHls } from '@/lib/hlsAttach';
import { customerCodeFromUrl } from '@/lib/streamSource';
import { useMusicCommands } from '@/lib/musicPlayer';
import { isTvMode } from '@/lib/tvMode';
import { SPARK_WARM_FALLBACK_MS, sparkSlot, type SparkEngine } from '@/lib/sparksPlayback';

const SPARK_FIELDS =
  'id, title, description, cloudflare_video_id, thumbnail_url, duration_seconds, width, height, created_at, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, verification_tier)';

/** Kód zákazníka Cloudflare z minula - spojení se serverem videí se naváže, ještě než přijde seznam Sparks. */
const STREAM_CODE_KEY = 'kine-stream-code';

function preconnectStream(code: string | null) {
  if (!code || !/^[a-z0-9]+$/i.test(code) || typeof document === 'undefined') return;
  const href = `https://customer-${code}.cloudflarestream.com`;
  if (document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = href;
  // hls.js stahuje přes CORS - spojení musí být "anonymní", jinak ho prohlížeč nepoužije.
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

function SparksPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const startId = searchParams.get('start');
  const [videos, setVideos] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const wheelLockRef = useRef(false);
  const [loading, setLoading] = useState(true);
  // Bez tohohle se spadlý dotaz tvářil jako "žádné Sparks tu nejsou".
  const [loadFailed, setLoadFailed] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [arrowsLeft, setArrowsLeft] = useState<number | null>(null);
  // Appka si pamatuje, jestli si uživatel v tomhle sezení zvuk už jednou
  // zapnul - autoplay se zvukem prohlížeče často blokují, takže nové video
  // vždycky nejdřív nastartuje potichu a zvuk se dorovná hned potom, pokud
  // si ho uživatel předtím zapnul (stejné chování jako TikTok/Reels).
  // Appka zkouší jet rovnou se zvukem (kliknutí do appky, které vás sem
  // přivedlo, obvykle stačí, aby to prohlížeč dovolil). Na false se přepne,
  // jen pokud si uživatel zvuk sám vypne.
  const soundEnabledRef = useRef(true);
  // Kdo se dívá - jednou pro všechny karty (dřív si to každá z ~80 karet zjišťovala sama).
  const [viewer, setViewer] = useState<SparkViewer>({ userId: null, ratingMode: 'like_dislike' });
  // Vlastní přehrávač (HLS), nebo iframe Cloudflare - rozhodne se po načtení stránky v prohlížeči.
  const [engine, setEngine] = useState<SparkEngine | null>(null);
  // Rozjelo se první video? Do té doby se nic nepřednačítá (bralo by mu data).
  const [warm, setWarm] = useState(false);
  const [saveData, setSaveData] = useState(false);
  const musicCommands = useMusicCommands();

  useEffect(() => {
    setEngine(chooseEngine({ nativeHls: supportsNativeHls(), mse: canPlayVodNatively(), forceCloudflare: searchParams.get('player') === 'cloudflare' }));
    // hls.js se stahuje hned, souběžně se seznamem Sparks - ne až když je první video na řadě.
    void preloadHls();
    try {
      preconnectStream(process.env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE || localStorage.getItem(STREAM_CODE_KEY));
    } catch {
      // bez úložiště se spojí, až přijde seznam
    }
    setSaveData(!!(navigator as any).connection?.saveData);
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? null;
      if (!uid) return;
      const { data: profile } = await supabase.from('profiles').select('rating_mode').eq('id', uid).maybeSingle();
      setViewer({ userId: uid, ratingMode: profile?.rating_mode === 'stars' ? 'stars' : 'like_dislike' });
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hudba na pozadí ztichne, dokud jsou Sparks otevřené (stejně jako u videa).
  useEffect(() => {
    musicCommands.setVideoTakeover(true);
    return () => musicCommands.setVideoTakeover(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pojistka: když se první video nerozjede (pomalá síť, zákaz přehrávání), přednačítání začne i tak.
  useEffect(() => {
    if (warm || videos.length === 0 || !engine) return;
    const timer = setTimeout(() => setWarm(true), SPARK_WARM_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [warm, videos.length, engine]);

  useEffect(() => {
    function updateArrowsPosition() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // Skutečná šířka videa se počítá stejně jako v CSS (.spark-slide):
      // min(100% šířky kontejneru, 100vh * 9/16) - NE pevných 460px.
      const videoWidth = Math.min(rect.width, window.innerHeight * (9 / 16));
      const videoRight = videoWidth / 2;
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
    setLoading(true);
    setLoadFailed(false);

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('videos')
      .select(SPARK_FIELDS)
      .eq('status', 'ready')
      .eq('visibility', 'public')
      // Sparks hrají samy - premiéra se tu objeví až ve chvíli, kdy začne.
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(80);

    // Chyba se dřív zahazovala a z prázdného výsledku vyšlo "Zatím tu
    // nejsou žádné Sparks" i při vypadlém spojení.
    if (error) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }

    const sparks: any[] = (data ?? []).filter(isSpark);

    // Odkaz na konkrétní Spark (?start=), který už není mezi nejnovějšími: přidá se na začátek -
    // jinak by se místo něj pustilo úplně jiné video.
    if (startId && !sparks.some((v) => v.id === startId)) {
      const { data: one } = await supabase
        .from('videos')
        .select(SPARK_FIELDS)
        .eq('id', startId)
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
        .maybeSingle();
      if (one && isSpark(one)) sparks.unshift(one);
    }

    // Spojení se serverem videí hned (a příště ještě dřív - kód si prohlížeč zapamatuje).
    const code = sparks.map((v) => customerCodeFromUrl(v.thumbnail_url)).find(Boolean) ?? null;
    if (code) {
      preconnectStream(code);
      try {
        localStorage.setItem(STREAM_CODE_KEY, code);
      } catch {
        // nic
      }
    }

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

  // Šipky nahoru/dolů (a PageUp/PageDown) = předchozí/další Spark. V režimu televize šipky řídí výběr prvků.
  useEffect(() => {
    if (videos.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTvMode()) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const dir = e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? -1 : 0;
      if (!dir) return;
      const next = activeIndex + dir;
      if (next < 0 || next >= videos.length) return;
      e.preventDefault();
      itemRefs.current[next]?.scrollIntoView({ behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [videos.length, activeIndex]);

  function markWarm() {
    setWarm(true);
  }

  if (loading) {
    return <p style={{ color: 'var(--text-faint)', padding: 20 }}>{t('loading')}</p>;
  }

  if (loadFailed) {
    return (
      <div style={{ padding: 20 }}>
        <LoadFailed onRetry={load} />
      </div>
    );
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
              {...sparkSlot(i, activeIndex, { engine, warm, saveData })}
              engine={engine}
              viewer={viewer}
              commentsOpen={commentsOpen}
              onToggleComments={() => setCommentsOpen((v) => !v)}
              soundEnabledRef={soundEnabledRef}
              onStarted={i === activeIndex ? markWarm : undefined}
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
          <button
            onClick={() => setCommentsOpen(false)}
            style={{
              position: 'absolute', top: 12, right: 12, background: 'var(--panel-raised)', border: 'none',
              color: 'var(--text)', width: 30, height: 30, borderRadius: '50%', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5,
            }}
            aria-label="Zavřít komentáře"
          >
            ✕
          </button>
          <div className="panel" style={{ marginBottom: 16 }}>
            <p className="panel-heading">Creator Profile</p>
            <div className="creator-row">
              <div className="creator-avatar" style={{ overflow: 'hidden' }}>
                {videos[activeIndex].profiles?.avatar_url ? (
                  <img loading="lazy" decoding="async"
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
