'use client';

import Link from 'next/link';
import { useMusicCommands, useMusicState } from '@/lib/musicPlayer';
import { useLanguage } from '@/lib/i18n';
import {
  PlayIcon, PauseIcon, PreviousIcon, NextIcon, ShuffleIcon, RepeatIcon, VolumeIcon, clock,
} from './MusicIcons';

/**
 * Obal místo videa.
 *
 * Tohle vidí divák na stránce videa, když je skladba v režimu "Obal".
 * Samotný zvuk hraje jinde - v trvalém přehrávači v kostře appky (viz
 * lib/musicPlayer.tsx), takže když divák odejde, hudba jde s ním.
 */
export default function MusicStage({ coverUrl }: { coverUrl: string | null }) {
  const { t } = useLanguage();
  const { track, queue, playing, currentTime, duration, volume, repeat, shuffle } = useMusicState();
  const commands = useMusicCommands();

  if (!track) return null;

  const total = duration || track.duration || 0;
  const cover = coverUrl ?? track.thumbnail;
  const repeatLabel = repeat === 'one' ? t('musicRepeatOne') : repeat === 'all' ? t('musicRepeatAll') : t('musicRepeatOff');

  return (
    <div className="music-stage">
      <div className="music-stage-cover">
        {cover ? (
          <img src={cover} alt={track.title} />
        ) : (
          <span className="music-stage-cover-empty" aria-hidden="true">♪</span>
        )}
      </div>

      <div className="music-stage-info">
        <p className="music-stage-title">{track.title}</p>
        {track.creator && <p className="music-stage-creator">{track.creator}</p>}
      </div>

      <div className="music-stage-seek">
        <span className="music-time">{clock(currentTime)}</span>
        <input
          type="range"
          className="music-range"
          min={0}
          max={Math.max(total, 1)}
          step={1}
          value={Math.min(currentTime, total)}
          onChange={(e) => commands.seek(Number(e.target.value))}
          aria-label={t('musicSeek')}
        />
        <span className="music-time">{clock(total)}</span>
      </div>

      <div className="music-stage-controls">
        <button
          type="button"
          className={`music-btn ${shuffle ? 'music-btn-active' : ''}`}
          onClick={commands.toggleShuffle}
          aria-label={t('musicShuffle')}
          aria-pressed={shuffle}
          title={t('musicShuffle')}
        >
          <ShuffleIcon />
        </button>

        <button type="button" className="music-btn" onClick={commands.previous} aria-label={t('musicPrevious')}>
          <PreviousIcon size={22} />
        </button>

        <button
          type="button"
          className="music-btn music-btn-primary music-btn-large"
          onClick={commands.toggle}
          aria-label={playing ? t('musicPause') : t('musicPlay')}
        >
          {playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
        </button>

        <button type="button" className="music-btn" onClick={commands.next} aria-label={t('musicNext')}>
          <NextIcon size={22} />
        </button>

        <button
          type="button"
          className={`music-btn ${repeat !== 'off' ? 'music-btn-active' : ''}`}
          onClick={commands.cycleRepeat}
          aria-label={repeatLabel}
          title={repeatLabel}
        >
          <RepeatIcon one={repeat === 'one'} />
        </button>
      </div>

      <div className="music-stage-volume">
        <VolumeIcon muted={volume === 0} />
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

      {queue.length > 1 && (
        <div className="music-queue">
          <p className="music-queue-title">{t('musicQueueHeading')}</p>
          <ol className="music-queue-list">
            {queue.map((item, index) => (
              <li key={item.id} className={item.id === track.id ? 'music-queue-current' : ''}>
                <span className="music-queue-index" aria-hidden="true">
                  {item.id === track.id ? '♪' : index + 1}
                </span>
                <Link href={`/watch/${item.id}`} className="music-queue-link">
                  <span className="music-queue-name">{item.title}</span>
                  {item.creator && <span className="music-queue-creator">{item.creator}</span>}
                </Link>
                {item.duration ? <span className="music-queue-time">{clock(item.duration)}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
