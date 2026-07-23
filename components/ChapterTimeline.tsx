'use client';

import { useEffect, useRef, useState } from 'react';
import { SpeakerIcon } from './ReactionIcons';

type Chapter = { time: number; title: string };

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ChapterTimeline({
  chapters,
  duration,
  player,
}: {
  chapters: Chapter[];
  duration: number;
  player: any;
}) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [volumeHover, setVolumeHover] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hoverTitle, setHoverTitle] = useState<string | null>(null);
  const [hoverX, setHoverX] = useState(0);

  const trackRef = useRef<HTMLDivElement>(null);
  const volumeTrackRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingRef = useRef<'seek' | 'volume' | null>(null);

  useEffect(() => {
    if (!player) return;
    const interval = setInterval(() => {
      if (draggingRef.current === 'seek') return; // netahat appkou přes prst uživatele
      if (typeof player.currentTime === 'number') setCurrent(player.currentTime);
      if (typeof player.paused === 'boolean') setPaused(player.paused);
      if (typeof player.muted === 'boolean') setMuted(player.muted);
      if (typeof player.volume === 'number' && draggingRef.current !== 'volume') setVolume(player.volume);
    }, 400);
    return () => clearInterval(interval);
  }, [player]);

  useEffect(() => {
    function getClientX(e: MouseEvent | TouchEvent): number {
      return 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
    }

    function handleMove(e: MouseEvent | TouchEvent) {
      const clientX = getClientX(e);
      if (draggingRef.current === 'seek' && trackRef.current) {
        const rect = trackRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        setCurrent(ratio * duration);
      } else if (draggingRef.current === 'volume' && volumeTrackRef.current) {
        const rect = volumeTrackRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        setVolume(ratio);
        if (player) { player.volume = ratio; player.muted = ratio === 0; }
      }
    }

    function handleUp(e: MouseEvent | TouchEvent) {
      const clientX = getClientX(e);
      if (draggingRef.current === 'seek' && trackRef.current && player) {
        const rect = trackRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        player.currentTime = ratio * duration;
        player.play();
      }
      draggingRef.current = null;
    }

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [duration, player]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  function showControlsTemporarily() {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (player && !player.paused) setControlsVisible(false);
    }, 3000);
  }

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!duration) return null;

  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  const progressPercent = Math.min((current / duration) * 100, 100);

  function segmentTitleAt(seconds: number): string | null {
    if (sorted.length === 0) return null;
    let title: string | null = null;
    for (const ch of sorted) {
      if (seconds >= ch.time) title = ch.title;
    }
    return title;
  }

  function handleTrackClick(e: React.MouseEvent) {
    if (!trackRef.current || !player) return;
    e.stopPropagation();
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const seconds = Math.max(0, Math.min(ratio * duration, duration));
    player.currentTime = seconds;
    player.play();
  }

  function handleTrackHover(e: React.MouseEvent) {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const seconds = Math.max(0, Math.min(ratio * duration, duration));
    setHoverX(e.clientX - rect.left);
    setHoverTitle(segmentTitleAt(seconds));
  }

  function togglePlay() {
    if (!player) return;
    paused ? player.play() : player.pause();
  }

  function toggleFullscreen() {
    const target = wrapRef.current?.parentElement;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      target.requestFullscreen?.();
    }
  }

  function handleVolumeSet(ratio: number) {
    if (!player) return;
    player.volume = ratio;
    player.muted = ratio === 0;
    setVolume(ratio);
  }

  function handleSpeedChange(rate: number) {
    if (!player) return;
    player.playbackRate = rate;
    setSpeed(rate);
  }

  return (
    <>
      {/* Neviditelná vrstva přes celé video - zachytává pohyb myši (kvůli
          automatickému schování ovládání) a klik (přehrát/pauza). */}
      <div
        onMouseMove={showControlsTemporarily}
        onClick={togglePlay}
        style={{ position: 'absolute', inset: 0, zIndex: 3, cursor: 'pointer' }}
      />

      <div
        ref={wrapRef}
        onMouseMove={(e) => { e.stopPropagation(); showControlsTemporarily(); }}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
          background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))',
          padding: '20px 14px 10px',
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      >
        {hoverTitle && (
          <div
            style={{
              position: 'absolute', bottom: 44, left: `${hoverX}px`, transform: 'translateX(-50%)',
              background: 'rgba(10,10,11,0.9)', color: '#fff', fontSize: 12, padding: '4px 8px',
              borderRadius: 6, whiteSpace: 'nowrap', pointerEvents: 'none',
            }}
          >
            {hoverTitle}
          </div>
        )}

        <div
          ref={trackRef}
          onMouseDown={(e) => { draggingRef.current = 'seek'; handleTrackClick(e); }}
          onTouchStart={(e) => {
            draggingRef.current = 'seek';
            if (!trackRef.current || !player) return;
            const rect = trackRef.current.getBoundingClientRect();
            const ratio = (e.touches[0].clientX - rect.left) / rect.width;
            player.currentTime = Math.max(0, Math.min(ratio * duration, duration));
          }}
          onMouseMove={handleTrackHover}
          onMouseLeave={() => setHoverTitle(null)}
          style={{
            position: 'relative', height: 6, background: 'rgba(255,255,255,0.25)',
            borderRadius: 999, cursor: 'pointer', marginBottom: 10,
          }}
        >
          <div
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 999,
              width: `${progressPercent}%`, background: '#fff', pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute', top: '50%', left: `${progressPercent}%`, width: 12, height: 12,
              borderRadius: '50%', background: '#fff', transform: 'translate(-50%, -50%)', pointerEvents: 'none',
              boxShadow: '0 0 3px rgba(0,0,0,0.5)',
            }}
          />
          {sorted.map((ch, i) => (
            <div
              key={i}
              style={{
                position: 'absolute', top: -4, left: `${(ch.time / duration) * 100}%`,
                width: 3, height: 14, background: 'rgba(10,10,11,0.9)', transform: 'translateX(-1.5px)',
                borderRadius: 2, pointerEvents: 'none',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', color: '#fff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              style={{ background: 'none', border: 'none', color: '#fff', padding: 0, cursor: 'pointer', fontSize: 16 }}
            >
              {paused ? '▶' : '❚❚'}
            </button>
            <span style={{ fontSize: 12, opacity: 0.85 }}>{formatTime(current)} / {formatTime(duration)}</span>
          </div>

          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'center' }}
            onMouseEnter={() => setVolumeHover(true)}
            onMouseLeave={() => setVolumeHover(false)}
          >
            <button
              onClick={(e) => { e.stopPropagation(); if (player) player.muted = !muted; }}
              style={{ background: 'none', border: 'none', color: '#fff', padding: 0, cursor: 'pointer', display: 'flex' }}
            >
              <SpeakerIcon muted={muted || volume === 0} size={18} />
            </button>

            <div
              ref={volumeTrackRef}
              className="volume-slider-track"
              style={{ width: volumeHover ? 70 : 0, opacity: volumeHover ? 1 : 0 }}
              onMouseDown={(e) => {
                e.stopPropagation();
                draggingRef.current = 'volume';
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                handleVolumeSet(Math.max(0, Math.min(ratio, 1)));
              }}
              onTouchStart={(e) => {
                draggingRef.current = 'volume';
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const ratio = (e.touches[0].clientX - rect.left) / rect.width;
                handleVolumeSet(Math.max(0, Math.min(ratio, 1)));
              }}
            >
              <div className="volume-slider-fill" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
              <div className="volume-slider-thumb" style={{ left: `${(muted ? 0 : volume) * 100}%` }} />
            </div>
          </div>

          <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
            <button
              onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => !v); }}
              style={{ background: 'none', border: 'none', color: '#fff', padding: 0, cursor: 'pointer', fontSize: 16 }}
            >
              ⋮
            </button>

            {settingsOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, width: 170,
                  background: 'rgba(20,20,22,0.95)', borderRadius: 8, padding: 10,
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', margin: '0 0 6px' }}>Rychlost přehrávání</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[0.25, 0.5, 1, 1.5, 2, 3, 5].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => handleSpeedChange(rate)}
                      style={{
                        background: speed === rate ? '#fff' : 'rgba(255,255,255,0.12)',
                        color: speed === rate ? '#0a0a0b' : '#fff',
                        border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      {rate}x
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
              style={{ background: 'none', border: 'none', color: '#fff', padding: 0, cursor: 'pointer', fontSize: 14 }}
            >
              {isFullscreen ? '⤡' : '⛶'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
