'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';

const HOVER_DELAY_MS = 700;
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
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMuted(!getSoundPref());
  }, []);

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
    const next = !muted;
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
      <div className={isSparks ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
        {video.thumbnail_url && !previewing && (
          <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
        )}
        {previewing && (
          <>
            <iframe
              key={muted ? 'muted' : 'unmuted'}
              src={`https://iframe.videodelivery.net/${video.cloudflare_video_id}?controls=false&autoplay=true&muted=${muted}&loop=true&preload=true`}
              style={{ width: '100%', height: '100%', border: 'none', position: 'absolute', inset: 0, pointerEvents: 'none' }}
              allow="autoplay"
            />
            <button
              onClick={toggleMute}
              style={{
                position: 'absolute', top: 6, right: 6, zIndex: 2, background: 'rgba(0,0,0,0.6)', border: 'none',
                color: '#fff', width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {muted ? '🔇' : '🔊'}
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
