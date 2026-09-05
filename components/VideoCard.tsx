'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/lib/i18n';
import { SpeakerIcon } from './ReactionIcons';
import VideoCardMenu from './VideoCardMenu';
import { supabase } from '@/lib/supabaseClient';
import { unhideVideo, unhideChannel } from '@/lib/hiddenContent';

const HOVER_DELAY_MS = 150;
const SOUND_PREF_KEY = 'kine-preview-sound-enabled';

function getSoundPref() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_PREF_KEY) === 'true';
}

function VideoCard({
  video,
  href,
  isSparks,
  progressPercent,
  formatDuration,
  reason,
  hideCreator,
}: {
  video: any;
  href: string;
  isSparks?: boolean;
  progressPercent?: number;
  formatDuration?: (seconds: number) => string;
  /** Proč se video nabízí - krátký popisek pod názvem (lib/homeRecommendation.ts). */
  reason?: string | null;
  hideCreator?: boolean;
}) {
  const { t } = useLanguage();
  const [previewing, setPreviewing] = useState(false);
  const [muted, setMuted] = useState(true);
  // Když si divák video (nebo celý kanál) schová, karta na místě zůstane a
  // změní se na hlášku s možností to vzít zpět - jako na YouTube. Kdyby
  // rovnou zmizela, ostatní karty by poskočily a nešlo by to vrátit.
  const [hidden, setHidden] = useState<null | 'video' | 'channel'>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previewing) setMuted(!getSoundPref());
  }, [previewing]);

  // Appka teď hlasitost dorovná do přehrávače pokaždé, když se stav
  // "muted" změní - i pokud se přehrávač zrovna teprve napojuje. Předtím
  // appka kliknutí tiše ignorovala, pokud přehrávač ještě nebyl 100 %
  // připravený, takže appka volbu vůbec neuložila.
  useEffect(() => {
    if (playerRef.current) playerRef.current.muted = muted;
  }, [muted]);

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
    const next = !muted;
    setMuted(next);
    localStorage.setItem(SOUND_PREF_KEY, String(!next));
  }

  async function undoHide() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;

    const ownerId = video.owner_id ?? video.profiles?.id;
    if (hidden === 'channel' && ownerId) {
      await unhideChannel(data.user.id, ownerId);
    } else {
      await unhideVideo(data.user.id, video.id);
    }
    setHidden(null);
  }

  if (hidden) {
    return (
      <div className={`video-card video-card-hidden ${isSparks ? 'video-card-hidden-sparks' : ''}`}>
        <p className="video-card-hidden-note">
          {hidden === 'channel' ? t('menuHiddenChannelNote') : t('menuHiddenVideoNote')}
        </p>
        <button type="button" className="video-card-hidden-undo" onClick={undoHide}>
          {t('menuUndo')}
        </button>
      </div>
    );
  }

  // Náhled při najetí musí vyplnit rámeček stejně jako obrázek náhledu
  // (ořízne se, nemá černé okraje). iframe se nedá "object-fit: cover"
  // jako obrázek, tak ho o kousek zvětšíme, aby video rámeček přesně
  // pokrylo. Zvětšení počítáme z poměru stran videa vůči rámečku - bez
  // toho se vodorovné video ve svislé kartě Sparks scvrklo na proužek.
  const containerAspect = isSparks ? 9 / 16 : 16 / 9;
  const sourceAspect = video.width && video.height ? video.width / video.height : 16 / 9;
  const coverScale = Math.min(
    Math.max(sourceAspect / containerAspect, containerAspect / sourceAspect),
    4
  );

  return (
    // Karta už není jeden velký odkaz: nabídka ⋮ a tlačítko zvuku musí být
    // vedle odkazu, ne v něm - tlačítko uvnitř odkazu je neplatné HTML
    // a prohlížeče se u něj chovají různě.
    <div
      className="video-card video-card-interactive"
      onMouseEnter={startHover}
      onMouseLeave={stopHover}
      onTouchStart={startHover}
      onTouchEnd={stopHover}
    >
      <Link href={href} className="video-card-link">
        <div className={isSparks ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
          {video.thumbnail_url && !previewing && (
            <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
          )}
          {previewing && (
            <iframe
              ref={iframeRef}
              src={`https://iframe.videodelivery.net/${video.cloudflare_video_id}?controls=false`}
              style={{
                width: '100%', height: '100%', border: 'none', position: 'absolute',
                inset: 0, pointerEvents: 'none',
                transform: `scale(${coverScale})`, transformOrigin: 'center',
              }}
              allow="autoplay"
            />
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
      </Link>

      {previewing && (
        <button className="video-card-sound-btn" onClick={toggleMute} aria-label={t('previewSound')}>
          <SpeakerIcon muted={muted} size={15} />
        </button>
      )}

      {/* Text a tři tečky jsou hned pod videem v jednom řádku - jako na
          YouTube. Tečky tak sedí u názvu, ne až na spodku celé karty. */}
      <div className="video-card-footer">
        <Link href={href} className="video-card-textlink">
          <p className="video-card-title">{video.title}</p>
          <p className="video-card-meta">
            {!hideCreator && <>{video.profiles?.username ?? t('unknownCreator')} · </>}
            {video.views} {t('views')}
          </p>
          {reason && <p className="video-card-reason">{reason}</p>}
        </Link>

        <VideoCardMenu
          video={video}
          onHide={setHidden}
          onActivity={(active) => { if (active) stopHover(); }}
        />
      </div>
    </div>
  );
}

/**
 * Karta se překreslí, jen když se jí změní vlastní data.
 *
 * Hlavní stránka donačítá videa po dávkách a při každé dávce se sáhne na
 * seznam bloků. Bez tohohle by React překreslil i všechny karty, které už
 * dávno na obrazovce jsou - a právě tam appka viditelně škubla.
 */
export default memo(VideoCard);
