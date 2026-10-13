'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Script from 'next/script';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { SpeakerIcon } from './ReactionIcons';
import VideoCardMenu from './VideoCardMenu';
import { supabase } from '@/lib/supabaseClient';
import { unhideVideo, unhideChannel } from '@/lib/hiddenContent';
import { isUpcomingPremiere } from '@/lib/scheduling';
import { attachVod, canPlayVodNatively } from '@/lib/vodPlayer';
import { customerCodeFromUrl, manifestUrl } from '@/lib/streamSource';
import { preloadHls } from '@/lib/hlsAttach';
import { rememberStreamCode } from '@/lib/networkHints';
import { previewsAllowed } from '@/lib/netQuality';

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
  priority,
}: {
  video: any;
  href: string;
  isSparks?: boolean;
  progressPercent?: number;
  formatDuration?: (seconds: number) => string;
  /** Proč se video nabízí - krátký popisek pod názvem (lib/homeRecommendation.ts). */
  reason?: string | null;
  hideCreator?: boolean;
  /** Karta nahoře na obrazovce: náhled se stáhne hned a přednostně (ne líně až po ostatních). */
  priority?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [previewing, setPreviewing] = useState(false);
  // Premiéra, která ještě nezačala: náhled po najetí nehraje (video jde pustit až v čase premiéry).
  const upcomingPremiere = isUpcomingPremiere(video);
  const [muted, setMuted] = useState(true);
  // Když si divák video (nebo celý kanál) schová, karta na místě zůstane a
  // změní se na hlášku s možností to vzít zpět - jako na YouTube. Kdyby
  // rovnou zmizela, ostatní karty by poskočily a nešlo by to vrátit.
  const [hidden, setHidden] = useState<null | 'video' | 'channel'>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Náhled po najetí hraje vlastní přehrávač (<video> + HLS, lib/vodPlayer.ts) - rozjede se
  // hned a bez černého bliknutí (obrázek náhledu zůstane, dokud video nehraje). Iframe
  // Cloudflare jen když to prohlížeč neumí nebo vlastní přehrávač selže.
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const [nativeFailed, setNativeFailed] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const nativePreview = previewing && !nativeFailed && canPlayVodNatively();

  useEffect(() => {
    if (previewing) setMuted(!getSoundPref());
  }, [previewing]);

  // Appka teď hlasitost dorovná do přehrávače pokaždé, když se stav
  // "muted" změní - i pokud se přehrávač zrovna teprve napojuje. Předtím
  // appka kliknutí tiše ignorovala, pokud přehrávač ještě nebyl 100 %
  // připravený, takže appka volbu vůbec neuložila.
  useEffect(() => {
    if (playerRef.current) playerRef.current.muted = muted;
    if (previewVideoRef.current) previewVideoRef.current.muted = muted;
  }, [muted]);

  // Vlastní přehrávač náhledu: kousek videa v nízké kvalitě, na smyčku.
  useEffect(() => {
    const el = previewVideoRef.current;
    if (!nativePreview || !el || !video.cloudflare_video_id) return;
    setPreviewPlaying(false);
    el.loop = true;
    el.muted = !getSoundPref();
    const handle = attachVod(el, manifestUrl(video.cloudflare_video_id, customerCodeFromUrl(video.thumbnail_url)), {
      startAt: null,
      bufferAhead: 10,
      bufferCap: 15,
      backBuffer: 15,
      // Náhled po najetí se do měření připojení nepočítá (lib/netQuality.ts).
      measure: false,
      onFatal: () => setNativeFailed(true),
    });
    let done = false;
    const tryPlay = () => {
      if (done || !el.paused) return;
      el.play().catch((e: any) => {
        // Se zvukem to prohlížeč bez klepnutí nepustí - náhled hraje aspoň potichu.
        if (!done && e?.name === 'NotAllowedError' && !el.muted) {
          el.muted = true;
          setMuted(true);
          el.play().catch(() => {});
        }
      });
    };
    const onPlaying = () => {
      done = true;
      setPreviewPlaying(true);
    };
    el.addEventListener('loadedmetadata', tryPlay);
    el.addEventListener('canplay', tryPlay);
    el.addEventListener('playing', onPlaying);
    tryPlay();
    return () => {
      done = true;
      el.removeEventListener('loadedmetadata', tryPlay);
      el.removeEventListener('canplay', tryPlay);
      el.removeEventListener('playing', onPlaying);
      handle.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativePreview, video.cloudflare_video_id]);

  // Jakmile se náhled začne přehrávat, appka se napojí na přehrávač
  // (SDK se může chvíli načítat, proto to zkouší v krátké smyčce) a pustí
  // video na smyčku, potichu nebo se zvukem podle uložené preference.
  useEffect(() => {
    if (!previewing || nativePreview || !video.cloudflare_video_id) return;
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
  }, [previewing, nativePreview, video.cloudflare_video_id]);

  // Kód zákazníka Cloudflare (z adresy náhledu) si prohlížeč zapamatuje - příště se
  // spojení se serverem videí naváže hned při načtení stránky (lib/networkHints.ts).
  useEffect(() => {
    rememberStreamCode(customerCodeFromUrl(video.thumbnail_url));
  }, [video.thumbnail_url]);

  function startHover() {
    if (!video.cloudflare_video_id || upcomingPremiere) return;
    // Náhledy po najetí vypnuté v Nastavení -> Vzhled.
    if (document.documentElement.getAttribute('data-previews') === '0') return;
    // Šetření dat / pomalé připojení: náhledy po najetí nestahují video (lib/netQuality.ts).
    if (!previewsAllowed()) return;
    // Neveřejné video (soukromé, pro odběratele) hraje jen s podepsaným
    // tokenem (lib/streamProtection.ts) - náhled po najetí by skončil
    // chybou Cloudflare. Bez viditelnosti v datech se bere jako veřejné.
    if (video.visibility && video.visibility !== 'public') return;
    // hls.js se začne stahovat hned (než uběhne prodleva) - náhled i stránka videa se pak rozjedou dřív.
    void preloadHls();
    hoverTimerRef.current = setTimeout(() => setPreviewing(true), HOVER_DELAY_MS);
  }

  function stopHover() {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setPreviewing(false);
    setPreviewPlaying(false);
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
      // Náhled jen po najetí MYŠÍ. Na telefonu se dřív spouštěl i dotykem - a protože
      // scrollování začíná dotykem na kartu, stahovalo se při projíždění feedu video
      // u každé karty, které se prst dotkl. Na mobilních datech to brzdilo všechno.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') startHover();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') stopHover();
      }}
    >
      <Link href={href} className="video-card-link">
        <div className={isSparks ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
          {/* U vlastního přehrávače obrázek zůstává pod videem (žádné černé bliknutí, než se video rozjede). */}
          {video.thumbnail_url && (!previewing || nativePreview) && (
            <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} priority={priority} />
          )}
          {nativePreview && (
            <video
              ref={previewVideoRef}
              className={`video-card-preview${previewPlaying ? ' playing' : ''}`}
              muted
              playsInline
              loop
              preload="auto"
              aria-hidden="true"
            />
          )}
          {/* Přehrávač Cloudflare (SDK) jen když je potřeba - dřív se stahoval na každé stránce. */}
          {previewing && !nativePreview && <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" strategy="afterInteractive" />}
          {previewing && !nativePreview && (
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
          {!previewing && video.duration_seconds && formatDuration && !upcomingPremiere ? (
            <span className="video-duration">{formatDuration(video.duration_seconds)}</span>
          ) : null}
          {upcomingPremiere && (
            <span className="video-premiere-badge">
              {t('premiereBadge')} · {new Date(video.scheduled_at).toLocaleString(DATE_LOCALES[lang], { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
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
