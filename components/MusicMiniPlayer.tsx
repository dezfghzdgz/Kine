'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useMusicCommands, useMusicState } from '@/lib/musicPlayer';
import { useLanguage } from '@/lib/i18n';
import {
  PlayIcon, PauseIcon, PreviousIcon, NextIcon, CloseIcon, VolumeIcon, clock,
} from './MusicIcons';

/**
 * Lišta dole.
 *
 * Není to jen ukazatel hudby na pozadí, ale ovladač toho, co zrovna hraje.
 * Když si divák u skladby přepne na video, lišta zůstane a ovládá rovnou
 * ten přehrávač - stejný čas, pauza funguje z obou stran. Dřív v takové
 * chvíli mizela, takže nešlo skladbu pozastavit a zase se k ní vrátit.
 *
 * Schová se jediné: když stránka videa ukazuje velký obal té samé skladby.
 * Tam je ovládání kousek nad ní a dvakrát to samé pod sebou nedává smysl.
 */
export default function MusicMiniPlayer() {
  const { t } = useLanguage();
  const { track, playing, currentTime, duration, volume, stageId, engineVisible } = useMusicState();
  const commands = useMusicCommands();

  const visible = !!track && stageId !== track.id;

  // Lišta stojí na místě, takže by jinak zakryla poslední řádek stránky.
  // Značka na <body> přidá dole místo přesně na tu dobu, kdy je vidět.
  // Háček musí být nad podmínkou dole - React nedovolí, aby se počet háčků
  // mezi vykresleními měnil.
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add('has-music-bar');
    return () => document.body.classList.remove('has-music-bar');
  }, [visible]);

  if (!track || !visible) return null;

  const total = duration || track.duration || 0;

  return (
    <div className="music-mini" role="region" aria-label={t('musicNowPlaying')}>
      {/* Posun tažením, ne jen kliknutím. Je to obyčejný posuvník, takže
          funguje myší, prstem i šipkami na klávesnici. */}
      <input
        type="range"
        className="music-mini-seek"
        min={0}
        max={Math.max(total, 1)}
        step={1}
        value={Math.min(currentTime, total)}
        onChange={(e) => commands.seek(Number(e.target.value))}
        aria-label={t('musicSeek')}
        style={{ ['--music-progress' as any]: `${total > 0 ? (currentTime / total) * 100 : 0}%` }}
      />

      <Link href={`/watch/${track.id}`} className="music-mini-track">
        {track.thumbnail ? (
          // key donutí prohlížeč obrázek skutečně vyměnit, když se přeskočí
          // na jinou skladbu.
          <img key={track.id} src={track.thumbnail} alt="" className="music-mini-cover" />
        ) : (
          <span className="music-mini-cover music-mini-cover-empty" aria-hidden="true">♪</span>
        )}
        <span className="music-mini-text">
          <span className="music-mini-title">{track.title}</span>
          <span className="music-mini-meta">
            {track.creator ? `${track.creator} · ` : ''}
            {clock(currentTime)} / {clock(total)}
            {engineVisible ? ` · ${t('musicPlayingVideo')}` : ''}
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

        <div className="music-mini-volume">
          <button
            type="button"
            className="music-btn"
            onClick={commands.toggleMute}
            aria-label={volume === 0 ? t('musicUnmute') : t('musicMute')}
            aria-pressed={volume === 0}
            title={volume === 0 ? t('musicUnmute') : t('musicMute')}
          >
            <VolumeIcon volume={volume} />
          </button>
          <input
            type="range"
            className="music-range music-range-volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => commands.setVolume(Number(e.target.value))}
            aria-label={t('musicVolume')}
          />
        </div>

        <button type="button" className="music-btn" onClick={commands.stop} aria-label={t('musicClose')}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
