'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { supabase } from '@/lib/supabaseClient';
import { ThumbsUpIcon, ThumbsDownIcon, SpeakerIcon, CommentIcon, ShareIcon } from './ReactionIcons';
import { shouldNotifyLikeMilestone } from '@/lib/likeMilestones';
import { useLanguage } from '@/lib/i18n';
import { detectDeviceClass } from '@/lib/deviceClass';
import { attachVod, reportSlowVideo, type VodHandle } from '@/lib/vodPlayer';
import { shouldReportSlowStart, statsReport, vodVerdict } from '@/lib/vodPlayerCore';
import { customerCodeFromUrl, manifestUrl } from '@/lib/streamSource';
import { useMusicCommands } from '@/lib/musicPlayer';
import {
  SPARK_ACTIVE_BUFFER_S,
  SPARK_BACK_BUFFER_S,
  SPARK_PLAY_RETRY_MS,
  SPARK_PRELOAD_BUFFER_S,
  afterPlayRejected,
  sparkPoster,
  type SparkEngine,
} from '@/lib/sparksPlayback';
import { bufferedAhead } from './PlaybackStats';

/** Kdo se dívá - stránka Sparks to zjistí jednou pro všechny karty (dřív každá karta zvlášť). */
export type SparkViewer = { userId: string | null; ratingMode: 'stars' | 'like_dislike' };

/**
 * Jedno video ve Sparks. Hraje ho vlastní přehrávač (<video> + HLS od
 * Cloudflare, lib/vodPlayer.ts); kdy se napojí, přednačte a co se načte,
 * rozhoduje stránka (lib/sparksPlayback.ts). Když vlastní přehrávač nejde,
 * karta přepne na iframe Cloudflare jako dřív.
 */
export default function SparksCard({
  video,
  active,
  attach,
  near,
  engine,
  viewer,
  commentsOpen,
  onToggleComments,
  soundEnabledRef,
  onStarted,
}: {
  video: any;
  active: boolean;
  /** Napojit video - hraje, nebo se přednačítá (stránka, lib/sparksPlayback.ts). */
  attach: boolean;
  /** Karta je blízko: náhled a počty (lajky, komentáře, odběr). */
  near: boolean;
  /** null = ještě se neví (první vykreslení) - ukáže se jen náhled. */
  engine: SparkEngine | null;
  viewer: SparkViewer;
  commentsOpen: boolean;
  onToggleComments: () => void;
  soundEnabledRef: { current: boolean };
  /** Video se rozjelo - stránka pak smí přednačítat další. */
  onStarted?: () => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const musicCommands = useMusicCommands();
  const userId = viewer.userId;
  const ratingMode = viewer.ratingMode;
  const [myScore, setMyScore] = useState<number | null>(null);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [totalRatings, setTotalRatings] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Vlastní přehrávač (hls.js / Safari). Přejde na iframe Cloudflare, když nejde.
  const [fallback, setFallback] = useState(false);
  const native = engine === 'native' && !fallback;
  const videoRef = useRef<HTMLVideoElement>(null);
  // Napojené video (null = jen náhled). Ve stavu, ne v ref: rozjezd a ovládání se spustí
  // právě jednou pro každé napojení (druhý běh by smazal stav "prohlížeč nepustil zvuk",
  // zatímco video už hraje potichu).
  const [vod, setVod] = useState<VodHandle | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [buffering, setBuffering] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const userPausedRef = useRef(false);
  // Prohlížeč nepustil video vůbec (ani potichu) - čeká se na klepnutí.
  const [needsTap, setNeedsTap] = useState(false);
  // Prohlížeč nepustil zvuk bez klepnutí - hraje potichu, nabídne se "zapnout zvuk".
  const [soundBlocked, setSoundBlocked] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const reportedRef = useRef<VodHandle | null>(null);

  // Záložní iframe Cloudflare (staré chování).
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);

  // Lajky, komentáře a odběr jen u karet poblíž - dřív si je hned po otevření
  // Sparks stahovalo všech ~80 karet naráz (i s přihlášením a profilem).
  const metaKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!near) return;
    const key = `${video.id}:${userId ?? ''}`;
    if (metaKeyRef.current === key) return;
    metaKeyRef.current = key;
    void loadReactions();
    void loadCommentCount();
    void loadSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, video.id, userId]);

  // Appka teď při aktivním videu ve Sparks (jakmile ho appka pustí) taky
  // po pár vteřinách skutečného sledování počítá zhlédnutí - stejně jako
  // appka watch stránka, s ochranným cooldownem proti opakovanému počítání.
  useEffect(() => {
    if (!active) return;
    const lastViewKey = `kine-viewed-${video.id}`;
    let lastViewedAt = 0;
    try {
      lastViewedAt = Number(localStorage.getItem(lastViewKey) ?? 0);
    } catch {
      // Bez úložiště se zhlédnutí započítá (server má vlastní ochranu).
    }
    const cooldownMs = 30 * 60 * 1000; // 30 minut

    if (Date.now() - lastViewedAt <= cooldownMs) return;

    const timer = setTimeout(() => {
      fetch('/api/videos/increment-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.id, device: detectDeviceClass() }),
      }).catch(() => {});
      try {
        localStorage.setItem(lastViewKey, String(Date.now()));
      } catch {
        // nic
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, [active, video.id]);

  // ---- vlastní přehrávač -------------------------------------------------------------

  // Napojení: video, které hraje, i přednačítané (další v řadě - jen první kus).
  useEffect(() => {
    if (!attach || !native) return;
    const el = videoRef.current;
    if (!el) return;
    el.loop = true;
    // Přednačtené video nikdy nehraje nahlas samo; zvuk dostane, až když je na řadě.
    el.muted = true;
    const handle = attachVod(el, manifestUrl(video.cloudflare_video_id, customerCodeFromUrl(video.thumbnail_url)), {
      startAt: null,
      // Přednačtené: jen první kus (pevný strop - jinak hls.js u nízké kvality stáhne klidně celé video).
      bufferAhead: activeRef.current ? SPARK_ACTIVE_BUFFER_S : SPARK_PRELOAD_BUFFER_S,
      bufferCap: activeRef.current ? undefined : SPARK_PRELOAD_BUFFER_S,
      backBuffer: SPARK_BACK_BUFFER_S,
      onFatal: (why) => {
        console.warn('Kine: Sparks - vlastní přehrávač nejde, hraje přehrávač Cloudflare', why);
        setFallback(true);
      },
    });
    setVod(handle);
    return () => {
      handle.detach();
      setVod((current) => (current === handle ? null : current));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attach, native, video.id]);

  // Na řadě: rozjet (se zvukem, když to prohlížeč dovolí - jinak potichu).
  // Mimo řadu: zastavit a vrátit na začátek (návrat na kartu začne od začátku, bez stahování).
  useEffect(() => {
    const el = videoRef.current;
    const handle = vod;
    if (!native || !el || !handle) return;
    if (!active) {
      handle.setBufferAhead(SPARK_PRELOAD_BUFFER_S, SPARK_PRELOAD_BUFFER_S);
      el.pause();
      try {
        if (el.currentTime > 0.05) el.currentTime = 0;
      } catch {
        // Ještě bez metadat - začne od začátku i tak.
      }
      setBuffering(false);
      return;
    }
    handle.setBufferAhead(SPARK_ACTIVE_BUFFER_S);
    userPausedRef.current = false;
    setUserPaused(false);
    setNeedsTap(false);
    setSoundBlocked(false);
    setMuted(!soundEnabledRef.current);
    setBuffering(el.readyState < 3);

    let done = false;
    let wantMuted = !soundEnabledRef.current;
    const attempt = () => {
      if (done || userPausedRef.current || !el.paused) return;
      el.muted = wantMuted;
      let p: Promise<void> | undefined;
      try {
        p = el.play();
      } catch {
        return;
      }
      p?.catch((e: any) => {
        if (done) return;
        const next = afterPlayRejected(e?.name, el.muted);
        if (next === 'retry-muted') {
          wantMuted = true;
          setSoundBlocked(true);
          attempt();
        } else if (next === 'needs-tap') {
          done = true;
          setNeedsTap(true);
          setBuffering(false);
        }
        // Přerušené načítání (AbortError) - zkusí to další pokus / událost.
      });
    };
    const onPlaying = () => {
      done = true;
    };
    el.addEventListener('loadedmetadata', attempt);
    el.addEventListener('canplay', attempt);
    el.addEventListener('playing', onPlaying);
    attempt();
    const timers = SPARK_PLAY_RETRY_MS.map((ms) => window.setTimeout(attempt, ms));
    return () => {
      done = true;
      timers.forEach((id) => window.clearTimeout(id));
      el.removeEventListener('loadedmetadata', attempt);
      el.removeEventListener('canplay', attempt);
      el.removeEventListener('playing', onPlaying);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, native, vod]);

  // Stav pro ovládání (zvuk, načítání) - jen u videa, které je na řadě.
  useEffect(() => {
    const el = videoRef.current;
    if (!native || !el || !active) return;
    // Rozjelo se už? Do té doby se o zastavení stará rozjezd (zkouší to znovu).
    let started = false;
    const onPlay = () => {
      userPausedRef.current = false;
      setUserPaused(false);
      setNeedsTap(false);
    };
    const onPlaying = () => {
      started = true;
      setBuffering(false);
      onStartedRef.current?.();
    };
    // Zastavené zvenku (tlačítko na sluchátkách, systém, obnova přehrávače po chybě):
    // ukáže se ▶ a klepnutím video pokračuje - jinak by stálo bez jakéhokoli tlačítka.
    const onPause = () => {
      if (!started || userPausedRef.current) return;
      userPausedRef.current = true;
      setUserPaused(true);
    };
    const onWaiting = () => setBuffering(true);
    const onVolume = () => setMuted(el.muted);
    el.addEventListener('play', onPlay);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('volumechange', onVolume);
    if (!el.paused && el.readyState >= 3) onPlaying();
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('volumechange', onVolume);
    };
  }, [active, native, vod]);

  // Tenký proužek, kolik videa už uběhlo (bez překreslování Reactu - jen styl).
  useEffect(() => {
    const el = videoRef.current;
    const bar = progressRef.current;
    if (!native || !el || !bar || !active) return;
    let raf = 0;
    const tick = () => {
      const d = el.duration;
      const share = Number.isFinite(d) && d > 0 ? Math.min(1, Math.max(0, el.currentTime / d)) : 0;
      bar.style.transform = `scaleX(${share})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      bar.style.transform = 'scaleX(0)';
    };
  }, [active, native, vod]);

  // Tlačítka na klávesnici a sluchátkách a zamčená obrazovka ovládají video, které je na řadě (ne hudbu).
  useEffect(() => {
    const el = videoRef.current;
    if (!native || !active || !el || !vod) return;
    musicCommands.setVideoControls({
      play: () => {
        userPausedRef.current = false;
        setUserPaused(false);
        setNeedsTap(false);
        void el.play().catch(() => {});
      },
      pause: () => {
        userPausedRef.current = true;
        setUserPaused(true);
        el.pause();
      },
      seek: (seconds: number) => {
        try {
          el.currentTime = Math.max(0, seconds);
        } catch {
          // ještě bez metadat
        }
      },
      currentTime: () => Number(el.currentTime) || 0,
      title: String(video.title ?? ''),
      creator: video.profiles?.display_name ?? video.profiles?.username ?? null,
      thumbnail: video.thumbnail_url ?? null,
    });
    return () => musicCommands.setVideoControls(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, native, vod, video.id]);

  // Pomalý rozjezd (nebo opakované zasekávání) se jednou nahlásí do /admin/errors - stejně jako u videí.
  useEffect(() => {
    const handle = vod;
    if (!native || !active || !handle || reportedRef.current === handle) return;
    const timer = setInterval(() => {
      if (reportedRef.current === handle) return;
      const s = handle.stats;
      if (s.hiddenBeforeStart) return;
      const waitingForTap = s.playRequestedAt === null;
      const waitedMs = s.playRequestedAt === null ? 0 : performance.now() - s.playRequestedAt;
      if (!shouldReportSlowStart({ firstFrameMs: s.firstFrameMs, waitedMs, stalls: s.stalls, waitingForTap })) return;
      reportedRef.current = handle;
      reportSlowVideo(
        statsReport(s, {
          videoId: video.id,
          durationS: video.duration_seconds ?? null,
          startAt: null,
          bufferedAheadS: bufferedAhead(videoRef.current),
          waitedMs,
        }),
        vodVerdict(s)
      );
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, native, vod, video.id]);

  // ---- záložní iframe Cloudflare ---------------------------------------------------------

  // Spoléhat jen na "muted=false" v adrese videa nestačí - prohlížeče
  // často tiché přehrávání se zvukem stejně zablokují. Místo toho appka
  // aktivně "chytí" přehrávač a zvuk mu zapne sama, jakmile je video aktivní.
  useEffect(() => {
    if (native || engine === null) return;
    if (!active) {
      playerRef.current = null;
      return;
    }

    setPaused(false);
    setMuted(!soundEnabledRef.current);

    const activatedAt = Date.now();

    const interval = setInterval(() => {
      if (iframeRef.current && (window as any).Stream && !playerRef.current) {
        const player = (window as any).Stream(iframeRef.current);
        playerRef.current = player;
        // Adresa videa už žádný stav nevynucuje - appka řídí zvuk, smyčku
        // i přehrávání výhradně tady, ať se to s ničím nepere.
        player.loop = true;
        player.muted = !soundEnabledRef.current;
        player.volume = 1;
        player.play?.();

        // Pokud prohlížeč přehrávání se zvukem odmítne, appka to po chvíli
        // pozná (video zůstane "paused") a radši ho pustí potichu, než aby
        // se vůbec nespustilo.
        setTimeout(() => {
          if (playerRef.current === player && player.paused) {
            player.muted = true;
            player.play?.();
          }
        }, 400);

        // Pauzu těsně po startu (první necelou vteřinu) appka ignoruje -
        // přehrávač ji občas nahlásí sám při rozjezdu, i když video běží.
        player.addEventListener?.('pause', () => {
          if (Date.now() - activatedAt > 700) setPaused(true);
        });
        player.addEventListener?.('play', () => setPaused(false));
        player.addEventListener?.('volumechange', () => setMuted(!!player.muted));

        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, video.id, native, engine]);

  // ---- data karty ------------------------------------------------------------------------

  async function loadReactions() {
    const { data: reactions } = await supabase.from('video_reactions').select('score, user_id').eq('video_id', video.id);
    if (reactions && reactions.length > 0) {
      setAvgScore(reactions.reduce((s, r) => s + (r.score ?? 3), 0) / reactions.length);
      setTotalRatings(reactions.length);
      const mine = reactions.find((r) => r.user_id === userId);
      setMyScore(mine?.score ?? null);
    } else {
      setAvgScore(null);
      setTotalRatings(0);
      setMyScore(null);
    }
  }

  async function loadCommentCount() {
    const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('video_id', video.id);
    setCommentCount(count ?? 0);
  }

  async function loadSubscription() {
    if (!userId || !video.profiles?.id || video.profiles.id === userId) {
      setSubscribed(false);
      return;
    }
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('subscriber_id')
      .eq('subscriber_id', userId)
      .eq('channel_id', video.profiles.id)
      .maybeSingle();
    setSubscribed(!!sub);
  }

  async function submitScore(score: number) {
    if (!userId) { router.push('/login'); return; }
    if (myScore === score) {
      await supabase.from('video_reactions').delete().eq('video_id', video.id).eq('user_id', userId);
    } else {
      const wasAlreadyLike = myScore !== null && myScore >= 4;
      await supabase.from('video_reactions').upsert({
        video_id: video.id, user_id: userId, score,
        reaction: score >= 4 ? 'like' : score <= 2 ? 'dislike' : null,
      });

      if (score >= 4 && !wasAlreadyLike && video.profiles?.id && video.profiles.id !== userId) {
        const { count } = await supabase
          .from('video_reactions')
          .select('*', { count: 'exact', head: true })
          .eq('video_id', video.id)
          .gte('score', 4);

        if (count && shouldNotifyLikeMilestone(count)) {
          await supabase.from('notifications').insert({
            user_id: video.profiles.id,
            type: 'like_milestone',
            message: `Tvoje video dosáhlo ${count} ${count === 1 ? 'lajku' : 'lajků'}!`,
            link: `/watch/${video.id}`,
          });
        }
      }
    }
    void loadReactions();
  }

  async function toggleSubscribe() {
    if (!userId || !video.profiles?.id) { router.push('/login'); return; }
    if (subscribed) {
      await supabase.from('subscriptions').delete().eq('subscriber_id', userId).eq('channel_id', video.profiles.id);
    } else {
      await supabase.from('subscriptions').insert({ subscriber_id: userId, channel_id: video.profiles.id });
    }
    setSubscribed(!subscribed);
  }

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/watch/${video.id}`);
      flash(t('linkCopied'));
    } catch {
      // Schránka nejde (starší prohlížeč, bez oprávnění) - nic se neděje.
    }
  }

  function flash(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2000);
  }

  // ---- ovládání --------------------------------------------------------------------------

  function playNow(el: HTMLVideoElement) {
    el.play().catch((e: any) => {
      if (afterPlayRejected(e?.name, el.muted) === 'retry-muted') {
        el.muted = true;
        setSoundBlocked(true);
        el.play().catch(() => setNeedsTap(true));
      } else if (e?.name === 'NotAllowedError') {
        setNeedsTap(true);
      }
    });
  }

  function togglePlayPause() {
    if (!active) return;
    const el = videoRef.current;
    if (native && el) {
      // Hraje potichu jen proto, že prohlížeč nepustil zvuk: první klepnutí zvuk zapne (jako TikTok).
      if (soundBlocked && !el.paused) {
        toggleMute();
        return;
      }
      if (el.paused) {
        userPausedRef.current = false;
        setUserPaused(false);
        setNeedsTap(false);
        // Klepnutí je svolení i ke zvuku: hraje podle volby, ne potichu z minulého pokusu.
        el.muted = !soundEnabledRef.current;
        setSoundBlocked(false);
        playNow(el);
      } else {
        userPausedRef.current = true;
        setUserPaused(true);
        el.pause();
      }
      return;
    }
    if (!playerRef.current) return;
    if (paused) {
      playerRef.current.play();
    } else {
      playerRef.current.pause();
    }
  }

  function toggleMute() {
    const el = videoRef.current;
    if (native && el) {
      const next = !el.muted;
      el.muted = next;
      soundEnabledRef.current = !next;
      setSoundBlocked(false);
      setMuted(next);
      // Klepnutí je svolení: video, které kvůli zákazu stálo, se teď rozjede.
      if (el.paused && !userPausedRef.current) {
        setNeedsTap(false);
        playNow(el);
      }
      return;
    }
    if (!playerRef.current) return;
    const next = !muted;
    playerRef.current.muted = next;
    soundEnabledRef.current = !next;
  }

  // Mezerník / K = přehrát/pauza, M = zvuk - jen u videa, které je na řadě.
  const togglePlayRef = useRef(togglePlayPause);
  togglePlayRef.current = togglePlayPause;
  const toggleMuteRef = useRef(toggleMute);
  toggleMuteRef.current = toggleMute;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return;
      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlayRef.current();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMuteRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  const creatorName = video.profiles?.display_name ?? video.profiles?.username ?? t('unknownCreator');
  const poster = near ? sparkPoster(video) : null;
  const showPlayIcon = active && (native ? userPaused || needsTap : paused);

  return (
    <div className="spark-slide">
      {/* SDK přehrávače Cloudflare jen pro záložní iframe (vlastní přehrávač ho nepotřebuje). */}
      {engine !== null && !native && <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" strategy="afterInteractive" />}
      <div className="spark-player-wrap" onClick={togglePlayPause} style={{ cursor: 'pointer', position: 'relative' }}>
        {native && near ? (
          <video
            ref={videoRef}
            key={video.id}
            className="spark-video"
            poster={poster ?? undefined}
            playsInline
            loop
            muted
            // Kolik stáhnout dopředu řídí přehrávač (lib/vodPlayer.ts) - přednačtené jen začátek.
            preload="metadata"
            aria-label={video.title ?? creatorName}
          />
        ) : !native && engine !== null && (active || attach) ? (
          <iframe
            ref={iframeRef}
            src={`https://iframe.videodelivery.net/${video.cloudflare_video_id}?controls=false`}
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          />
        ) : poster ? (
          <img className="spark-poster" src={poster} alt="" decoding="async" />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#0a0a0b' }} />
        )}
        {native && active && buffering && !needsTap && !userPaused && <span className="spark-spinner" role="status" aria-label={t('loading')} />}
        {showPlayIcon && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 44, color: '#fff' }}>▶</span>
          </div>
        )}
        {native && active && soundBlocked && (
          <button
            type="button"
            className="spark-sound-hint"
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
          >
            <SpeakerIcon muted size={15} /> {t('sparksTapForSound')}
          </button>
        )}
        {active && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            aria-label={muted ? t('playerUnmute') : t('playerMute')}
            style={{
              position: 'absolute', top: 14, right: 14, background: 'rgba(0,0,0,0.5)', border: 'none',
              color: '#fff', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 5,
            }}
          >
            <SpeakerIcon muted={muted} size={16} />
          </button>
        )}
        {native && (
          <div className="spark-progress" aria-hidden="true">
            <div ref={progressRef} className="spark-progress-fill" />
          </div>
        )}
      </div>

      {toastMsg && <div className="spark-toast">{toastMsg}</div>}

      <div className="spark-info">
        <Link href={`/channel/${video.profiles?.id}`} style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
          @{video.profiles?.username ?? 'uzivatel'}
        </Link>
        <p style={{ color: '#fff', fontSize: 13, margin: '4px 0 0', opacity: 0.9 }}>{video.title}</p>
      </div>

      <div className="spark-actions">
        {ratingMode === 'stars' ? (
          <div className="spark-action-item">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[5, 4, 3, 2, 1].map((n) => (
                <span
                  key={n}
                  onClick={() => submitScore(n)}
                  style={{
                    fontSize: 20, cursor: 'pointer', color: (myScore ?? 0) >= n ? '#fff' : 'rgba(255,255,255,0.4)',
                    padding: '3px 6px', lineHeight: 1, display: 'inline-block',
                  }}
                >
                  ★
                </span>
              ))}
            </div>
            <span className="spark-action-label">{avgScore ? avgScore.toFixed(1) : '—'}</span>
          </div>
        ) : (
          <>
            <div className="spark-action-item" onClick={() => submitScore(5)}>
              <ThumbsUpIcon filled={myScore === 5} size={28} />
              <span className="spark-action-label">{totalRatings > 0 ? totalRatings : ''}</span>
            </div>
            <div className="spark-action-item" onClick={() => submitScore(1)}>
              <ThumbsDownIcon filled={myScore === 1} size={28} />
            </div>
          </>
        )}

        <div className="spark-action-item" onClick={onToggleComments}>
          <span style={{ color: commentsOpen ? '#fff' : 'rgba(255,255,255,0.85)' }}>
            <CommentIcon size={24} />
          </span>
          <span className="spark-action-label">{commentCount}</span>
        </div>

        <div className="spark-action-item" onClick={handleShare}>
          <span style={{ color: 'rgba(255,255,255,0.85)' }}>
            <ShareIcon size={24} />
          </span>
          <span className="spark-action-label">{t('share')}</span>
        </div>

        {video.profiles?.id && userId !== video.profiles?.id && (
          <div className="spark-action-item" onClick={toggleSubscribe}>
            <span
              style={{
                width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: subscribed ? 'rgba(255,255,255,0.3)' : '#fff',
                color: subscribed ? '#fff' : '#0a0a0b', fontSize: 15, fontWeight: 700,
              }}
            >
              {subscribed ? '✓' : '+'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
