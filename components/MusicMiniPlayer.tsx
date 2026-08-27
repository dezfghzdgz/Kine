'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useMusicCommands, useMusicState } from '@/lib/musicPlayer';
import { useLanguage } from '@/lib/i18n';
import { PlayIcon, PauseIcon, PreviousIcon, NextIcon, CloseIcon, clock } from './MusicIcons';

/**
 * Lišta dole, když hudba hraje a divák je někde jinde v appce.
 *
 * Schová se ve chvíli, kdy stránka videa ukazuje velký obal té samé
 * skladby - dvoje ovládání téhož vedle sebe by jen mátlo.
 */
export default function MusicMiniPlayer() {
  const { t } = useLanguage();
  const { track, playing, currentTime, duration, stageId } = useMusicState();
  const commands = useMusicCommands();

  const visible = !!track && stageId !== track.id;

  // Lišta stojí na místě přes celou šířku, takže by jinak zakryla poslední
  // řádek stránky. Značka na <body> přidá dole místo přesně na tu dobu,
  // kdy je lišta vidět. Háček musí být nad tou podmínkou dole - React
  // nedovolí, aby se počet háčků mezi vykresleními měnil.
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add('has-music-bar');
    return () => document.body.classList.remove('has-music-bar');
  }, [visible]);

  if (!track || !visible) return null;

  const total = duration || track.duration || 0;
  const progress = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0;

  return (
    <div className="music-mini" role="region" aria-label={t('musicNowPlaying')}>
      <div className="music-mini-progress" aria-hidden="true">
        <div className="music-mini-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <Link href={`/watch/${track.id}`} className="music-mini-track">
        {track.thumbnail ? (
          <img src={track.thumbnail} alt="" className="music-mini-cover" />
        ) : (
          <span className="music-mini-cover music-mini-cover-empty" aria-hidden="true">♪</span>
        )}
        <span className="music-mini-text">
          <span className="music-mini-title">{track.title}</span>
          <span className="music-mini-meta">
            {track.creator ? `${track.creator} · ` : ''}
            {clock(currentTime)} / {clock(total)}
          </span>
        </span>
      </Link>

      <div className="music-mini-controls">
        <button type="button" className="music-btn" onClick={commands.previous} aria-label={t('musicPrevious')}>
          <PreviousIcon />
        </button>
        <button
          type="button"
          className="music-btn music-btn-primary"
          onClick={commands.toggle}
          aria-label={playing ? t('musicPause') : t('musicPlay')}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button type="button" className="music-btn" onClick={commands.next} aria-label={t('musicNext')}>
          <NextIcon />
        </button>
        <button type="button" className="music-btn" onClick={commands.stop} aria-label={t('musicClose')}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
