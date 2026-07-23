'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { buildVideoBlocks, isSpark } from '@/lib/videoBlocks';
import { getTotalReactionCount, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';
import { supabase } from '@/lib/supabaseClient';
import { computeTrustRating } from '@/lib/trustRating';
import VideoReactions from '@/components/VideoReactions';
import CommentSection from '@/components/CommentSection';
import AddToPlaylist from '@/components/AddToPlaylist';
import SubscribeButton from '@/components/SubscribeButton';
import DownloadButton from '@/components/DownloadButton';
import WatchHistoryTracker from '@/components/WatchHistoryTracker';
import ChapterTimeline from '@/components/ChapterTimeline';
import CaptionsOverlay from '@/components/CaptionsOverlay';
import ReportModal from '@/components/ReportModal';
import VerifiedBadge from '@/components/VerifiedBadge';
import Toast, { ToastType } from '@/components/Toast';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';

function formatChapterTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function WatchPageInner() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const videoId = params.id as string;
  const [video, setVideo] = useState<any>(null);
  const [otherVideos, setOtherVideos] = useState<any[]>([]);
  const [showUpNext, setShowUpNext] = useState(false);
  const [upNextCountdown, setUpNextCountdown] = useState(8);
  const [trustRating, setTrustRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [inWatchLater, setInWatchLater] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [showAiBadge, setShowAiBadge] = useState(true);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [videoId]);

  useEffect(() => {
    setShowAiBadge(true);
    const timer = setTimeout(() => setShowAiBadge(false), 10000);
    return () => clearTimeout(timer);
  }, [videoId]);

  // Klávesové zkratky: mezerník = pauza/přehrát, šipky = posun o 5s, F = celá obrazovka.
  // Ignorujeme je, pokud uživatel zrovna něco píše (komentář apod.).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      const player = playerRef.current;
      if (!player) return;

      if (e.code === 'Space') {
        e.preventDefault();
        player.paused ? player.play() : player.pause();
      } else if (e.code === 'ArrowRight') {
        player.currentTime = (player.currentTime ?? 0) + 5;
      } else if (e.code === 'ArrowLeft') {
        player.currentTime = Math.max((player.currentTime ?? 0) - 5, 0);
      } else if (e.key.toLowerCase() === 'f') {
        wrapRef.current?.requestFullscreen?.();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handlePlayerSdkReady() {
    if (iframeRef.current && (window as any).Stream) {
      playerRef.current = (window as any).Stream(iframeRef.current);
      playerRef.current.muted = false;
      playerRef.current.volume = 1;
      playerRef.current.play?.();
      setPlayerReady(true);

      const t = searchParams.get('t');
      if (t) {
        const seconds = Number(t);
        if (!Number.isNaN(seconds)) {
          setTimeout(() => {
            if (playerRef.current) {
              playerRef.current.currentTime = seconds;
              playerRef.current.play();
            }
          }, 300);
        }
      } else {
        // Bez odkazu na konkrétní okamžik appka zkusí appku appku
        // pokračovat tam, kde appku appku appka appku naposledy
        // sledoval - klidně i z jiného zařízení, appka appku pozici
        // appku ukládá do databáze appky, ne jen appku appku appku
        // appku telefonu appku appku prohlížeči.
        resumeFromSavedProgress();
      }
    }
  }

  async function resumeFromSavedProgress() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    const { data: history } = await supabase
      .from('watch_history')
      .select('progress_seconds, completed')
      .eq('user_id', authData.user.id)
      .eq('video_id', videoId)
      .single();

    if (
      history?.progress_seconds &&
      !history.completed &&
      history.progress_seconds > 10
    ) {
      setTimeout(() => {
        if (playerRef.current) {
          playerRef.current.currentTime = history.progress_seconds;
          playerRef.current.play();
          const mm = Math.floor(history.progress_seconds / 60);
          const ss = String(history.progress_seconds % 60).padStart(2, '0');
          setToast({ message: `Pokračuješ od ${mm}:${ss}`, type: 'success' });
        }
      }, 300);
    }
  }

  // Uloží rozkoukanost videa (appku appku appku appka), aby se dala
  // najít i z jiného zařízení - jednou za 8 sekund, ne při každém
  // snímku, ať appka appku appku databázi appku appku zbytečně nezavaluje.
  useEffect(() => {
    if (!playerReady) return;
    const interval = setInterval(async () => {
      const player = playerRef.current;
      if (!player || !video?.id) return;

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const currentTime = Math.floor(player.currentTime ?? 0);
      const duration = video.duration_seconds ?? 0;
      const completed = duration > 0 && currentTime >= duration - 5;

      await supabase.from('watch_history').upsert(
        {
          user_id: authData.user.id,
          video_id: video.id,
          progress_seconds: currentTime,
          completed,
          watched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,video_id' }
      );
    }, 8000);

    return () => clearInterval(interval);
  }, [playerReady, video?.id]);

  // Zkoušíme opakovaně (ne jen jednou), dokud se přehrávač skutečně
  // nepřipojí - řeší to spolehlivě jak první návštěvu, tak přechod
  // mezi videi, bez ohledu na to, kdy přesně doběhne načtení skriptu.
  useEffect(() => {
    setPlayerReady(false);
    setShowUpNext(false);
    playerRef.current = null;

    const interval = setInterval(() => {
      if (iframeRef.current && (window as any).Stream && !playerRef.current) {
        handlePlayerSdkReady();
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [video?.id]);

  // Po dohrání videa nabídneme další doporučené, s automatickým odpočtem
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;
    const player = playerRef.current;

    function handleEnded() {
      if (otherVideos.length > 0) {
        setShowUpNext(true);
        setUpNextCountdown(8);
      }
    }
    player.addEventListener?.('ended', handleEnded);
    return () => player.removeEventListener?.('ended', handleEnded);
  }, [playerReady, otherVideos]);

  useEffect(() => {
    if (!showUpNext) return;
    if (upNextCountdown <= 0) {
      router.push(`/watch/${otherVideos[0].id}`);
      return;
    }
    const timer = setTimeout(() => setUpNextCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [showUpNext, upNextCountdown]);

  function seekTo(seconds: number) {
    if (playerRef.current) {
      playerRef.current.currentTime = seconds;
      playerRef.current.play();
    }
  }

  async function load() {
    setLoading(true);
    setNotFound(false);

    const { data, error } = await supabase
      .from('videos')
      .select('*, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, created_at, verification_tier)')
      .eq('id', videoId)
      .single();

    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setVideo(data);
    document.title = `${data.title} - Kine`;

    // Ochrana proti umělému nahánění zhlédnutí:
    // 1) počítáme až po pár vteřinách skutečného sledování, ne hned při otevření stránky
    // 2) stejné video se stejnému prohlížeči nepočítá vícekrát během krátké doby
    const lastViewKey = `kine-viewed-${videoId}`;
    const lastViewedAt = Number(localStorage.getItem(lastViewKey) ?? 0);
    const cooldownMs = 30 * 60 * 1000; // 30 minut

    if (Date.now() - lastViewedAt > cooldownMs) {
      setTimeout(() => {
        fetch('/api/videos/increment-view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId }),
        });
        localStorage.setItem(lastViewKey, String(Date.now()));
      }, 5000);
    }

    if (data.profiles) {
      computeTrustRatingClient(data.profiles.id, data.profiles.created_at).then(async (score) => {
        const reactionCount = await getTotalReactionCount(data.profiles.id);
        if (reactionCount >= RATING_UNLOCK_THRESHOLD) setTrustRating(score);
      });
    }

    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      const { data: systemPlaylist } = await supabase
        .from('playlists')
        .select('id')
        .eq('owner_id', authData.user.id)
        .eq('is_system', true)
        .maybeSingle();

      if (systemPlaylist) {
        const { data: wl } = await supabase
          .from('playlist_videos')
          .select('video_id')
          .eq('playlist_id', systemPlaylist.id)
          .eq('video_id', videoId)
          .maybeSingle();
        setInWatchLater(!!wl);
      }
    }

    const { data: others } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, width, height, duration_seconds, profiles!videos_owner_id_fkey(username)')
      .eq('status', 'ready')
      .eq('visibility', 'public')
      .neq('id', videoId)
      .order('created_at', { ascending: false })
      .limit(48);

    const currentIsSpark = isSpark(data);
    const matchingFormat = (others ?? []).filter((v: any) => isSpark(v) === currentIsSpark);

    setOtherVideos(matchingFormat.slice(0, 24));
    setLoading(false);
  }

  async function computeTrustRatingClient(profileId: string, createdAt: string): Promise<number> {
    const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const ageScore = Math.min(ageDays / 180, 1);

    const { data: videos } = await supabase.from('videos').select('id').eq('owner_id', profileId);
    const videoIds = (videos ?? []).map((v) => v.id);

    let likeRatio = 0.9;
    if (videoIds.length > 0) {
      const { data: reactions } = await supabase.from('video_reactions').select('score').in('video_id', videoIds);
      if (reactions && reactions.length > 0) {
        const avg = reactions.reduce((sum, r) => sum + (r.score ?? 3), 0) / reactions.length;
        likeRatio = (avg - 1) / 4;
      }
    }

    return Math.round(Math.min(Math.max(60 + ageScore * 20 + likeRatio * 20, 50), 99));
  }

  async function shareVideo() {
    await navigator.clipboard.writeText(`${window.location.origin}/watch/${videoId}`);
    setToast({ message: 'Odkaz na video zkopírován', type: 'success' });
    setShareMenuOpen(false);
  }

  async function shareMoment() {
    const seconds = Math.floor(playerRef.current?.currentTime ?? 0);
    await navigator.clipboard.writeText(`${window.location.origin}/watch/${videoId}?t=${seconds}`);
    setToast({ message: 'Odkaz na tento okamžik zkopírován', type: 'success' });
    setShareMenuOpen(false);
  }

  async function toggleWatchLater() {
    if (!userId) {
      router.push('/login');
      return;
    }

    const { data: systemPlaylist } = await supabase
      .from('playlists')
      .select('id')
      .eq('owner_id', userId)
      .eq('is_system', true)
      .maybeSingle();

    if (!systemPlaylist) return;

    if (inWatchLater) {
      await supabase.from('playlist_videos').delete().eq('playlist_id', systemPlaylist.id).eq('video_id', videoId);
      setInWatchLater(false);
    } else {
      await supabase.from('playlist_videos').upsert({ playlist_id: systemPlaylist.id, video_id: videoId });
      setInWatchLater(true);
    }
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (notFound || !video) {
    return (
      <div className="auth-gate">
        <p>Tohle video neexistuje, nebo na něj nemáš přístup.</p>
      </div>
    );
  }

  const creatorName = video.profiles?.display_name ?? video.profiles?.username ?? 'neznámý tvůrce';
  const chapters: { time: number; title: string }[] = video.chapters ?? [];
  const captions: { time: number; text: string }[] = video.captions ?? [];

  return (
    <div className="watch-layout">
      <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" onLoad={handlePlayerSdkReady} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <WatchHistoryTracker videoId={video.id} />
      <div>
        <div
          ref={wrapRef}
          className={`player-wrap ${video.height > video.width ? 'player-wrap-vertical' : ''}`}
          style={video.height > video.width ? {} : { aspectRatio: '16/9' }}
        >
          <iframe
            ref={iframeRef}
            src={`https://iframe.videodelivery.net/${video.cloudflare_video_id}?controls=false`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
            allowFullScreen
          />
          {video.is_ai_generated && showAiBadge && (
            <div
              style={{
                position: 'absolute', top: 10, right: 10, zIndex: 6,
                background: 'rgba(10,10,11,0.75)', color: '#fff', fontSize: 11, fontWeight: 600,
                padding: '4px 9px', borderRadius: 6, letterSpacing: 0.3,
              }}
            >
              AI obsah
            </div>
          )}
          {playerReady && (
            <ChapterTimeline chapters={chapters} duration={video.duration_seconds ?? 0} player={playerRef.current} />
          )}
          {playerReady && captions.length > 0 && (
            <CaptionsOverlay captions={captions} player={playerRef.current} />
          )}
          {showUpNext && otherVideos[0] && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,11,0.92)', zIndex: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
              <div style={{ textAlign: 'center', maxWidth: 460 }}>
                <p style={{ color: 'var(--text-faint)', fontSize: 12, marginBottom: 14 }}>
                  Další video za {upNextCountdown}s - vyber si, nebo počkej
                </p>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {otherVideos.slice(0, 2).map((v: any) => (
                    <div
                      key={v.id}
                      onClick={() => router.push(`/watch/${v.id}`)}
                      style={{ cursor: 'pointer', width: 180 }}
                    >
                      <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
                        {v.thumbnail_url && (
                          <Image src={v.thumbnail_url} alt={v.title} width={180} height={101} />
                        )}
                      </div>
                      <p style={{ color: '#fff', fontSize: 13, fontWeight: 600, margin: 0 }}>{v.title}</p>
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowUpNext(false)} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', marginTop: 18 }}>
                  {t('cancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        <h1 className="video-title">{video.title}</h1>
        {video.hashtags && video.hashtags.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, marginBottom: 4 }}>
            {video.hashtags.map((h: string) => (
              <Link key={h} href={`/hashtag/${h}`} style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500 }}>
                #{h}
              </Link>
            ))}
          </div>
        )}
        <div className="video-meta" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <Link href={`/channel/${video.profiles?.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="profile-avatar-small" style={{ width: 28, height: 28 }}>
              {video.profiles?.avatar_url ? <img src={video.profiles.avatar_url} alt={creatorName} /> : null}
            </span>
            <span>{creatorName}</span>
            <VerifiedBadge tier={video.profiles?.verification_tier} />
                {trustRating !== null && trustRating >= 90 && <span title={`Vysoký rating (${trustRating}%)`} style={{ marginLeft: 5, fontSize: 13 }}>⭐</span>}
          </Link>
          <span>{video.views} {t('views')}</span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <VideoReactions videoId={video.id} ownerId={video.profiles?.id} />
          {video.profiles?.id && <SubscribeButton channelId={video.profiles.id} />}
          <div style={{ position: 'relative' }}>
            <button className="reaction-btn" onClick={() => setShareMenuOpen((v) => !v)}>🔗 {t('share')}</button>
            {shareMenuOpen && (
              <div className="profile-dropdown" style={{ bottom: 'auto', top: 'calc(100% + 8px)', left: 0, width: 200 }}>
                <button className="profile-dropdown-item" onClick={shareVideo}>{t('shareVideo')}</button>
                <button className="profile-dropdown-item" onClick={shareMoment}>{t('shareMoment')}</button>
              </div>
            )}
          </div>
          <AddToPlaylist videoId={video.id} />
          <DownloadButton videoId={video.id} cloudflareVideoId={video.cloudflare_video_id} />
          <button className={`reaction-btn ${inWatchLater ? 'active' : ''}`} onClick={toggleWatchLater}>
            {inWatchLater ? `✓ ${t('watchLater')}` : `+ ${t('watchLater')}`}
          </button>
          <button className="reaction-btn" onClick={() => setReportOpen(true)}>🚩 {t('report')}</button>
        </div>

        {reportOpen && <ReportModal videoId={video.id} onClose={() => setReportOpen(false)} />}

        {video.has_paid_promotion && (
          <p style={{
            fontSize: 12, background: 'var(--panel-raised)', border: '1px solid var(--border)',
            padding: '8px 12px', borderRadius: 8, color: 'var(--text-dim)', marginTop: 10,
          }}>
            ⓘ Toto video obsahuje placenou propagaci
          </p>
        )}

        {video.is_premiere && video.scheduled_at && new Date(video.scheduled_at) > new Date() && (
          <p style={{
            fontSize: 13, background: 'var(--panel-raised)', border: '1px solid var(--border)',
            padding: '10px 12px', borderRadius: 8, color: 'var(--text)', marginTop: 10, fontWeight: 600,
          }}>
            🎬 Premiéra: video bude k přehrání {new Date(video.scheduled_at).toLocaleString('cs-CZ')}
          </p>
        )}

        {otherVideos.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <p className="section-title">Další videa</p>
            {buildVideoBlocks(otherVideos).map((block, bi) => (
              <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
                {block.items.map((v: any) => (
                  <Link
                    href={block.type === 'sparks' ? `/sparks?start=${v.id}` : `/watch/${v.id}`}
                    key={v.id}
                    className="video-card"
                  >
                    <div className={block.type === 'sparks' ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
                      {v.thumbnail_url ? (
                        <Image src={v.thumbnail_url} alt={v.title} width={320} height={180} />
                      ) : null}
                      <div className="play-badge">▶</div>
                    </div>
                    <p className="video-card-title">{v.title}</p>
                    <p className="video-card-meta">
                      {v.profiles?.username ?? 'neznámý tvůrce'} · {v.views} {t('views')}
                    </p>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="section-title">Interaction Panel</p>

        <div className="panel">
          <p className="panel-heading">Creator Profile</p>
          <div className="creator-row">
            <div className="creator-avatar" style={{ overflow: 'hidden' }}>
              {video.profiles?.avatar_url ? (
                <img src={video.profiles.avatar_url} alt={creatorName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : null}
            </div>
            <div>
              <Link href={`/channel/${video.profiles?.id}`} className="creator-name" style={{ display: 'block' }}>
                {creatorName}
                <VerifiedBadge tier={video.profiles?.verification_tier} />
                {trustRating !== null && trustRating >= 90 && <span title={`Vysoký rating (${trustRating}%)`} style={{ marginLeft: 5, fontSize: 13 }}>⭐</span>}
              </Link>
              {trustRating !== null && <p className="creator-trust">Rating: {trustRating}%</p>}
            </div>
          </div>
        </div>

        <CommentSection
          videoId={video.id}
          description={video.description}
          ownerId={video.profiles?.id}
          onSeek={seekTo}
          video={{
            duration_seconds: video.duration_seconds,
            category: video.category,
            language: video.language,
            created_at: video.created_at,
            made_for_kids: video.made_for_kids,
            visibility: video.visibility,
          }}
        />
      </div>
    </div>
  );
}

export default function WatchPage() {
  return (
    <Suspense fallback={null}>
      <WatchPageInner />
    </Suspense>
  );
}
