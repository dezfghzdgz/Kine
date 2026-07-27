'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Script from 'next/script';
import { useLanguage } from '@/lib/i18n';
import { SpeakerIcon } from './ReactionIcons';

const HOVER_DELAY_MS = 150;
const SOUND_PREF_KEY = 'kine-preview-sound-enabled';

function getSoundPref() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_PREF_KEY) === 'true';
}

export default function VideoCard({
  video,
  href,
  isSparks,
  progressPercent,
  formatDuration,
}: {
  video: any;
  href: string;
  isSparks?: boolean;
  progressPercent?: number;
  formatDuration?: (seconds: number) => string;
}) {
  const { t } = useLanguage();
  const [previewing, setPreviewing] = useState(false);
  const [muted, setMuted] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMuted(!getSoundPref());
  }, []);

  // Jakmile se náhled začne přehrávat, appka se napojí na přehrávač
  // (SDK se může chvíli načítat, proto to zkouší v krátké smyčce) a pustí
  // video na smyčku, potichu nebo se zvukem podle uložené preference.
  useEffect(() => {
    if (!previewing || !video.cloudflare_video_id) return;
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      if (iframeRef.current && (window as any).Stream && !playerRef.current) {
        const player = (window as any).Stream(iframeRef.current);
        playerRef.current = player;
        player.muted = getSoundPref() ? false : true;
        player.loop = true;
        player.play?.();
        clearInterval(interval);
      }
    }, 50);
    return () => {
      cancelled = true;
      clearInterval(interval);
      playerRef.current = null;
    };
  }, [previewing, video.cloudflare_video_id]);

  function startHover() {
    if (!video.cloudflare_video_id) return;
    hoverTimerRef.current = setTimeout(() => setPreviewing(true), HOVER_DELAY_MS);
  }

  function stopHover() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setPreviewing(false);
  }

  function toggleMute(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!playerRef.current) return;
    const next = !muted;
    playerRef.current.muted = next;
    setMuted(next);
    localStorage.setItem(SOUND_PREF_KEY, String(!next));
  }

  return (
    <Link
      href={href}
      className="video-card"
      onMouseEnter={startHover}
      onMouseLeave={stopHover}
      onTouchStart={startHover}
      onTouchEnd={stopHover}
    >
      <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" strategy="lazyOnload" />
      <div className={isSparks ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
        {video.thumbnail_url && !previewing && (
          <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
        )}
        {previewing && (
          <>
            <iframe
              ref={iframeRef}
              src={`https://iframe.videodelivery.net/${video.cloudflare_video_id}?controls=false`}
              style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', inset: 0, pointerEvents: 'none' }}
              allow="autoplay"
            />
            <button
              onClick={toggleMute}
              style={{
                position: 'absolute', top: 6, right: 6, zIndex: 2, background: 'rgba(0,0,0,0.75)',
                border: '1px solid rgba(255,255,255,0.3)', color: '#fff', width: 28, height: 28, padding: 0,
                borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <SpeakerIcon muted={muted} size={15} />
            </button>
          </>
        )}
        <div className="play-badge">▶</div>
        {typeof progressPercent === 'number' && progressPercent > 3 && (
          <div className="watch-progress-track">
            <div className="watch-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        )}
        {!previewing && video.duration_seconds && formatDuration ? (
          <span className="video-duration">{formatDuration(video.duration_seconds)}</span>
        ) : null}
      </div>
      <p className="video-card-title">{video.title}</p>
      <p className="video-card-meta">
        {video.profiles?.username ?? 'neznámý tvůrce'} · {video.views} {t('views')}
      </p>
    </Link>
  );
}
