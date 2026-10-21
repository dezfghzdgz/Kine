'use client';

import { useEffect, useRef, useState } from 'react';
import { SpeakerIcon, MaximizeIcon, MinimizeIcon } from './ReactionIcons';
import { useLanguage } from '@/lib/i18n';
import { PlayIcon, PauseIcon } from './MusicIcons';
import { autoHideDelay, clampSeek, decideTap, formatTime, tapSide, type Tap, type TapSide } from '@/lib/playerControls';
import { OPEN_SHORTCUTS_EVENT } from './KeyboardShortcuts';
import { qualityLabel, type QualityLevel } from '@/lib/vodPlayerCore';
import { pipActive, pipSupported, togglePictureInPicture, watchPictureInPicture } from '@/lib/pictureInPicture';
import UiIcon, { type UiIconName } from './UiIcon';
import { readCaptionSize, saveCaptionSize, type CaptionSize } from './CaptionsOverlay';

/**
 * Řádek nabídky ⋮ přehrávače: ikona, popisek, vpravo hodnota (a šipka, když se otevře
 * podnabídka). Všechny řádky stejné - dřív měl každý jiný vzhled (sklo z obecného
 * pravidla pro <button> prosakovalo jen do některých).
 */
function MenuRow({ icon, label, value, chevron, className, onClick }: { icon: UiIconName; label: string; value?: string; chevron?: boolean; className?: string; onClick?: () => void }) {
  return (
    <button type="button" role="menuitem" className={`player-menu-row${className ? ` ${className}` : ''}`} onClick={onClick}>
      <UiIcon name={icon} size={17} />
      <span className="player-menu-label">{label}</span>
      {(value || chevron) && (
        <span className="player-menu-value">
          {value}
          {chevron && <UiIcon name="chevronRight" size={14} />}
        </span>
      )}
    </button>
  );
}

type Chapter = { time: number; title: string };

/**
 * Ovládací lišta přehrávače (jméno má z dob, kdy ukazovala jen kapitoly).
 *
 * Posuvník s kapitolami, přehrát/pauza, čas, zvuk, nabídka ⋮ (titulky,
 * časovač spánku, rychlost) a celá obrazovka. Myš ji vidí při pohybu,
 * po třech vteřinách klidu zmizí, dokud video hraje.
 *
 * DOTYK (telefon, iPad, televize bez klávesnice)
 *
 * Prst není myš a lišta to dlouho nerozlišovala:
 *  - klepnutí na video ukázalo ovládání a ZÁROVEŇ zastavilo přehrávání,
 *    takže kdo se chtěl jen podívat, kde je, video tím pauznul;
 *  - tlačítka měla 16 px, prst potřebuje aspoň 44;
 *  - bez délky videa v databázi se lišta nevykreslila vůbec - a to
 *    vypadalo přesně jako "žádné ovládání".
 *
 * Teď: klepnutí prstem lištu jen ukáže/schová, přehrávání má velké
 * tlačítko uprostřed, dvojité klepnutí na kraj posune o 10 s jako na
 * YouTube, cíle jsou 44 px a délka se vezme z přehrávače, když v databázi
 * chybí. Co se dá spočítat bez prohlížeče (kam se klepnulo, dvojité
 * klepnutí, čas), je v lib/playerControls.ts a má test.
 */
export default function ChapterTimeline({
  chapters,
  duration,
  player,
  hasCaptions,
  captionsEnabled,
  onToggleCaptions,
  isMaximized,
  onToggleMaximize,
  compact = false,
  previewSrc,
  theater,
  onToggleTheater,
  loop,
  onToggleLoop,
  autoplay,
  onToggleAutoplay,
  qualities = [],
  quality = -1,
  playingHeight = null,
  onQuality,
  dataSaver,
  onToggleStats,
  hideCenterToggle = false,
}: {
  chapters: Chapter[];
  duration: number;
  player: any;
  hasCaptions?: boolean;
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  /** Mini přehrávač (rámeček ~300 px): jen posuvník, přehrát, zvuk a celá
   *  obrazovka. Čas, posuvník hlasitosti a nabídka ⋮ se do něj nevejdou. */
  compact?: boolean;
  /** Náhled snímku v daném čase (najetí na posuvník, jako na YouTube). */
  previewSrc?: (seconds: number) => string | null;
  /** Kino režim (široký přehrávač) - tlačítko jen na počítači. */
  theater?: boolean;
  onToggleTheater?: () => void;
  /** Opakovat video pořád dokola. */
  loop?: boolean;
  onToggleLoop?: () => void;
  /** Po konci pustit další video. */
  autoplay?: boolean;
  onToggleAutoplay?: () => void;
  /** Volba kvality (vlastní přehrávač, lib/vodPlayer.ts); prázdné = kvalitu volí přehrávač sám. */
  qualities?: QualityLevel[];
  /** Zvolená kvalita (index úrovně), -1 = automaticky. */
  quality?: number;
  /** Co právě hraje (u Automaticky v závorce). */
  playingHeight?: number | null;
  onQuality?: (index: number) => void;
  /**
   * Šetření dat (lib/netQuality.ts) tam, kde se kvalita vybrat nedá (Safari volí
   * kvalitu sám): přepínač lehký / plný režim. Bez toho se položka neukáže.
   */
  dataSaver?: { light: boolean; onToggle: () => void };
  /** Statistiky přehrávání (components/PlaybackStats.tsx). */
  onToggleStats?: () => void;
  /** Stránka ukazuje vlastní tlačítko „Přehrát“ (zákaz přehrání bez klepnutí) - velké tlačítko uprostřed schovat, ať nejsou dvě. */
  hideCenterToggle?: boolean;
}) {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(true);
  // Délka podle přehrávače - záloha pro videa, která ji nemají v databázi.
  const [playerDuration, setPlayerDuration] = useState(0);
  // Dotyková podoba: velké tlačítko uprostřed, větší cíle. Zapne se podle
  // zařízení hned a natrvalo při prvním klepnutí prstem (tablet s myší).
  const [touchUi, setTouchUi] = useState(false);
  const [ripple, setRipple] = useState<{ side: TapSide; label: string; nonce: number } | null>(null);
  const lastTapRef = useRef<Tap | null>(null);
  const surfaceDownRef = useRef<number | null>(null);
  const [settingsView, setSettingsView] = useState<'main' | 'speed' | 'sleep' | 'quality' | 'captions'>('main');
  // Velikost titulků (S/M/L) - pamatuje se v prohlížeči (components/CaptionsOverlay.tsx).
  const [captionSize, setCaptionSize] = useState<CaptionSize>('m');
  useEffect(() => setCaptionSize(readCaptionSize()), []);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const sleepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSleepTimer(minutes: number | null) {
    if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current);
    setSleepMinutes(minutes);
    if (minutes) {
      sleepTimeoutRef.current = setTimeout(() => {
        player?.pause?.();
        setSleepMinutes(null);
      }, minutes * 60 * 1000);
    }
  }

  useEffect(() => {
    return () => { if (sleepTimeoutRef.current) clearTimeout(sleepTimeoutRef.current); };
  }, []);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [volumeHover, setVolumeHover] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Obraz v obraze: video v plovoucím okénku i mimo prohlížeč (jiná karta, jiná appka).
  // Jen vlastní <video> - iframe Cloudflare se zvenku do okénka dát nedá (lib/pictureInPicture.ts).
  const [pipOk, setPipOk] = useState(false);
  const [pipOn, setPipOn] = useState(false);
  useEffect(() => {
    setPipOk(pipSupported(player));
    setPipOn(pipActive(player));
    return watchPictureInPicture(player, setPipOn);
  }, [player]);

  useEffect(() => {
    if (!settingsOpen) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
        setSettingsView('main');
      }
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [settingsOpen]);
  const [speed, setSpeed] = useState(1);
  const [hoverTitle, setHoverTitle] = useState<string | null>(null);
  const [hoverX, setHoverX] = useState(0);
  // Čas pod myší (náhled snímku a čas nad posuvníkem); null = myš není nad posuvníkem.
  const [hoverSeconds, setHoverSeconds] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const { t } = useLanguage();

  const trackRef = useRef<HTMLDivElement>(null);
  const volumeTrackRef = useRef<HTMLDivElement>(null);
  // Délka pro handlery tažení, které žijí v efektu a viděly by starou hodnotu.
  const totalRef = useRef(0);
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
      if (typeof player.duration === 'number' && Number.isFinite(player.duration) && player.duration > 0) {
        setPlayerDuration(player.duration);
      }
    }, 400);
    return () => clearInterval(interval);
  }, [player]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) setTouchUi(true);
  }, []);

  useEffect(() => {
    function getClientX(e: MouseEvent | TouchEvent): number {
      return 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
    }

    function handleMove(e: MouseEvent | TouchEvent) {
      const clientX = getClientX(e);
      if (draggingRef.current === 'seek' && trackRef.current) {
        const rect = trackRef.current.getBoundingClientRect();
        const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
        setCurrent(ratio * totalRef.current);
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
        player.currentTime = ratio * totalRef.current;
        player.play();
      }
      const wasDragging = draggingRef.current !== null;
      draggingRef.current = null;
      setIsDragging(false);
      // Po puštění posuvníku se ovládání zase schová (během tažení zůstává).
      if (wasDragging) showControlsTemporarily();
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
  }, [player]);

  // Aktuální přehrávač a otevřená nabídka pro odpočty, které žijí mimo vykreslení.
  const playerLiveRef = useRef<any>(player);
  playerLiveRef.current = player;
  const settingsOpenRef = useRef(false);
  settingsOpenRef.current = settingsOpen;
  const touchUiRef = useRef(false);
  touchUiRef.current = touchUi;

  /** Schovat ovládání za `ms` - jen když video hraje, nic se netáhne a nabídka ⋮ je zavřená. */
  function scheduleHide(ms: number) {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      // Na celou obrazovku se ovládání schovává úplně stejně jako v okně -
      // dřív tam zůstávalo natrvalo viset přes video.
      const p = playerLiveRef.current;
      if (p && !p.paused && !draggingRef.current && !settingsOpenRef.current) setControlsVisible(false);
    }, ms);
  }

  function showControlsTemporarily(reason?: 'touch' | 'mouse') {
    setControlsVisible(true);
    scheduleHide(autoHideDelay(reason ?? (touchUiRef.current ? 'touch' : 'mouse')));
  }

  // Video se rozjelo -> ovládání pryč skoro hned; zastavilo se -> ovládání zůstane vidět.
  // Podle událostí přehrávače (ne podle čtení stavu každých 400 ms - to by schovávání zpozdilo).
  useEffect(() => {
    if (!player) return;
    const onPlay = () => setPaused(false);
    // Schovat až když obraz opravdu běží (playing) - při pomalém rozjezdu by lišta zmizela
    // ještě nad náhledem a kolečkem.
    const onPlaying = () => {
      setPaused(false);
      scheduleHide(autoHideDelay('play'));
    };
    const onPause = () => {
      setPaused(true);
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
    player.addEventListener?.('play', onPlay);
    player.addEventListener?.('playing', onPlaying);
    player.addEventListener?.('pause', onPause);
    return () => {
      player.removeEventListener?.('play', onPlay);
      player.removeEventListener?.('playing', onPlaying);
      player.removeEventListener?.('pause', onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // Zavřená nabídka ⋮ - ovládání se zase může schovat.
  useEffect(() => {
    if (!settingsOpen && controlsVisible) scheduleHide(autoHideDelay(touchUiRef.current ? 'touch' : 'mouse'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Délka: z databáze, a když tam není, tak od přehrávače. Dřív se bez ní
  // lišta nevykreslila vůbec - u starších videí bez uložené délky pak
  // nešlo video ani pozastavit.
  const total = duration > 0 ? duration : playerDuration;
  totalRef.current = total;

  const sorted = [...chapters].sort((a, b) => a.time - b.time);
  const progressPercent = total > 0 ? Math.min((current / total) * 100, 100) : 0;

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
    const seconds = clampSeek(ratio * total, total);
    player.currentTime = seconds;
    player.play();
  }

  function handleTrackHover(e: React.MouseEvent) {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const seconds = clampSeek(ratio * total, total);
    setHoverX(e.clientX - rect.left);
    setTrackWidth(rect.width);
    setHoverTitle(segmentTitleAt(seconds));
    setHoverSeconds(seconds);
  }

  // Náhled snímku: čas se zaokrouhlí (asi sto kroků na video), ať se při
  // pohybu myší nestahuje obrázek pro každou vteřinu zvlášť.
  const previewStep = total > 0 ? Math.max(1, Math.round(total / 100)) : 1;
  const previewAt = hoverSeconds !== null ? Math.min(Math.round(hoverSeconds / previewStep) * previewStep, Math.max(0, Math.floor(total) - 1)) : null;
  const previewImage = previewAt !== null && previewSrc && !touchUi ? previewSrc(previewAt) : null;
  const PREVIEW_W = 168;
  const previewLeft = Math.max(PREVIEW_W / 2, Math.min(hoverX, Math.max(PREVIEW_W / 2, trackWidth - PREVIEW_W / 2)));
  const currentChapter = sorted.length > 0 ? segmentTitleAt(current) : null;

  function togglePlay() {
    if (!player) return;
    paused ? player.play() : player.pause();
  }

  /**
   * Klepnutí do videa.
   *
   * Myš: ukázat ovládání a přepnout přehrávání - jako dřív.
   *
   * Prst: klepnutí lištu jen ukáže, nebo schová, když už je vidět a video
   * hraje. Přehrávání má vlastní velké tlačítko uprostřed. Dvojité klepnutí
   * na levý/pravý kraj posune o 10 s (lib/playerControls.ts rozhoduje,
   * co je dvojité a která strana).
   */
  function handleSurfaceTap(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    // Jen klepnutí, které na vrstvě i začalo. Puštění myši nad videem po
    // tažení posuvníku (hlasitost, čas) není kliknutí do videa - dřív by
    // každé takové puštění zároveň zastavilo přehrávání.
    const startedHere = surfaceDownRef.current === e.pointerId;
    surfaceDownRef.current = null;
    if (!startedHere || draggingRef.current) return;

    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';

    if (!isTouch) {
      showControlsTemporarily('mouse');
      togglePlay();
      return;
    }

    setTouchUi(true);

    const rect = e.currentTarget.getBoundingClientRect();
    const side = tapSide(e.clientX - rect.left, rect.width);
    const now = Date.now();
    const decision = decideTap(lastTapRef.current, { time: now, side });
    lastTapRef.current = decision.kind === 'double' ? null : { time: now, side };

    if (decision.kind === 'double') {
      if (player) {
        player.currentTime = clampSeek((player.currentTime ?? 0) + decision.seekBy, total);
        setCurrent(player.currentTime ?? 0);
      }
      setRipple({
        side: decision.side,
        label: decision.seekBy > 0 ? `+${decision.seekBy} s` : `${decision.seekBy} s`,
        nonce: now,
      });
      showControlsTemporarily('touch');
      return;
    }

    if (controlsVisible && !paused) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(false);
    } else {
      showControlsTemporarily('touch');
    }
  }

  // Tlačítka lišty: na dotyku aspoň 44 px, myši stačí 36. Ikony zůstávají
  // stejné, roste jen plocha, na kterou se dá trefit.
  const hit = touchUi ? 44 : 36;
  const iconBtn: React.CSSProperties = {
    // boxShadow: tlačítka bez třídy mají z globals.css skleněný rámeček - na liště přes video
    // dělal kolem každé ikony krabičku.
    background: 'none', border: 'none', boxShadow: 'none', color: '#fff', padding: 0, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minWidth: hit, minHeight: hit, borderRadius: 8, fontSize: 16,
    WebkitTapHighlightColor: 'transparent',
  };

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
      {isDragging && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, cursor: 'grabbing' }}
        />
      )}

      {/* Neviditelná vrstva přes celé video - zachytává pohyb myši (kvůli
          automatickému schování ovládání) a klepnutí. Co klepnutí udělá,
          rozhoduje handleSurfaceTap podle toho, jestli je od myši nebo od
          prstu. Pointer události místo onClick proto, že jen ony říkají,
          čím se klepnulo. */}
      <div
        // Jen skutečná myš: telefon po klepnutí posílá i náhradní „pohyb myši“ - ten by
        // ovládání držel déle, než má (1,5 s místo 1 s).
        onPointerMove={(e) => { if (e.pointerType === 'mouse') showControlsTemporarily('mouse'); }}
        onPointerDown={(e) => { if (e.button === 0) surfaceDownRef.current = e.pointerId; }}
        onPointerUp={handleSurfaceTap}
        style={{
          position: 'absolute', inset: 0, zIndex: 3, cursor: 'pointer',
          // Dvojité klepnutí nesmí přiblížit stránku ani vybrat text.
          touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      />

      {/* Odezva na dvojité klepnutí na kraj: "+10 s" / "-10 s" se rozplyne. */}
      {ripple && (
        <div key={ripple.nonce} className={`player-tap-ripple player-tap-ripple-${ripple.side}`} aria-hidden="true">
          {ripple.label}
        </div>
      )}

      {/* Velké přehrát/pauza uprostřed - jen na dotyku. Myš přepíná
          kliknutím do videa, tam by tlačítko jen překáželo. */}
      {touchUi && (
        <button
          type="button"
          className={`player-center-toggle ${controlsVisible && !hideCenterToggle ? '' : 'player-center-toggle-hidden'}`}
          aria-label={paused ? t('playerPlay') : t('playerPause')}
          onClick={(e) => { e.stopPropagation(); togglePlay(); showControlsTemporarily('touch'); }}
        >
          {paused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
        </button>
      )}

      <div
        ref={wrapRef}
        onPointerMove={(e) => { e.stopPropagation(); if (e.pointerType === 'mouse') showControlsTemporarily('mouse'); }}
        // Prst na liště (posuvník, tlačítka) - odpočet schování začne znovu.
        onPointerDown={(e) => { if (e.pointerType !== 'mouse') showControlsTemporarily('touch'); }}
        style={{
          // S otevřenou nabídkou ⋮ nad tlačítkem „Přehrát“ uprostřed (z-index 7) - jinak ho překrývalo.
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: settingsOpen ? 8 : 5,
          background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))',
          // Na iPhonu v celé obrazovce sedí dole ukazatel domů a po stranách
          // výřez - lišta se jim vyhne. Bez viewport-fit=cover v layoutu jsou
          // ty hodnoty nula (viz app/layout.tsx).
          padding: compact
            ? '14px 8px 6px'
            : '20px calc(14px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) calc(14px + env(safe-area-inset-left, 0px))',
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      >
        {hoverSeconds !== null && !compact && (
          <div
            className="player-hover-preview"
            style={{ left: `calc(${previewImage ? previewLeft : hoverX}px + ${compact ? 8 : 14}px)` }}
          >
            {previewImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewImage} alt="" width={PREVIEW_W} height={Math.round((PREVIEW_W * 9) / 16)} decoding="async" />
            )}
            {hoverTitle && <span className="player-hover-chapter">{hoverTitle}</span>}
            <span className="player-hover-time">{formatTime(hoverSeconds)}</span>
          </div>
        )}

        {/* Obal posuvníku dává prstu vyšší plochu (dráha je na pohled 6 px,
            trefit se dá do 22 px, na dotyku 30 px). Výpočty berou rozměr
            samotné dráhy (trackRef), takže se nic neposune. Bez známé délky
            posuvník nemá co ukazovat, ostatní tlačítka ale zůstávají. */}
        {total > 0 && (
        <div
          onMouseDown={(e) => { draggingRef.current = 'seek'; setIsDragging(true); handleTrackClick(e); }}
          onTouchStart={(e) => {
            draggingRef.current = 'seek';
            setIsDragging(true);
            if (!trackRef.current || !player) return;
            const rect = trackRef.current.getBoundingClientRect();
            const ratio = (e.touches[0].clientX - rect.left) / rect.width;
            player.currentTime = clampSeek(ratio * total, total);
          }}
          onMouseMove={handleTrackHover}
          onMouseLeave={() => { setHoverTitle(null); setHoverSeconds(null); }}
          style={{
            padding: touchUi ? '12px 0' : '8px 0', margin: touchUi ? '-12px 0 -2px' : '-8px 0 2px',
            cursor: 'pointer', touchAction: 'none',
          }}
        >
        <div
          ref={trackRef}
          style={{
            position: 'relative', height: 6, background: 'rgba(255,255,255,0.25)',
            borderRadius: 999, pointerEvents: 'none',
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
                position: 'absolute', top: -4, left: `${(ch.time / total) * 100}%`,
                width: 3, height: 14, background: 'rgba(10,10,11,0.9)', transform: 'translateX(-1.5px)',
                borderRadius: 2, pointerEvents: 'none',
              }}
            />
          ))}
        </div>
        </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', color: '#fff', marginTop: total > 0 ? 8 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              aria-label={paused ? t('playerPlay') : t('playerPause')}
              title={paused ? t('playerPlay') : t('playerPause')}
              style={iconBtn}
            >
              {paused ? <PlayIcon size={20} /> : <PauseIcon size={20} />}
            </button>
            {!compact && (
              <span style={{ fontSize: 12, opacity: 0.85, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {total > 0 ? `${formatTime(current)} / ${formatTime(total)}` : formatTime(current)}
              </span>
            )}
            {!compact && currentChapter && (
              <span className="player-chapter-label" title={currentChapter}>• {currentChapter}</span>
            )}
          </div>

          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'center' }}
            onMouseEnter={() => setVolumeHover(true)}
            onMouseLeave={() => setVolumeHover(false)}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (player) player.muted = !muted; }}
              aria-label={muted ? t('playerUnmute') : t('playerMute')}
              title={muted ? t('playerUnmute') : t('playerMute')}
              style={iconBtn}
            >
              <SpeakerIcon muted={muted} volume={volume} size={18} />
            </button>

            {!compact && (
            <div
              ref={volumeTrackRef}
              className="volume-slider-track"
              style={{ width: (volumeHover || isDragging) ? 70 : 0, opacity: (volumeHover || isDragging) ? 1 : 0 }}
              onMouseDown={(e) => {
                e.stopPropagation();
                draggingRef.current = 'volume';
                setIsDragging(true);
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                handleVolumeSet(Math.max(0, Math.min(ratio, 1)));
              }}
              onTouchStart={(e) => {
                draggingRef.current = 'volume';
                setIsDragging(true);
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const ratio = (e.touches[0].clientX - rect.left) / rect.width;
                handleVolumeSet(Math.max(0, Math.min(ratio, 1)));
              }}
            >
              <div className="volume-slider-fill" style={{ width: `${(muted ? 0 : volume) * 100}%` }} />
              <div className="volume-slider-thumb" style={{ left: `${(muted ? 0 : volume) * 100}%` }} />
            </div>
            )}
          </div>

          <div ref={settingsRef} style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
            {/* Titulky jedním klikem (jako CC na YouTube) - jen u videa, které je má. Zapnuté = podtržené barvou Kine. */}
            {hasCaptions && onToggleCaptions && !compact && (
              <button
                type="button"
                className="player-cc-btn"
                onClick={(e) => { e.stopPropagation(); onToggleCaptions(); }}
                aria-pressed={!!captionsEnabled}
                title={`${t('captionsMenuLabel')}: ${captionsEnabled ? t('onLabel') : t('offLabel')} (C)`}
                aria-label={`${t('captionsMenuLabel')}: ${captionsEnabled ? t('onLabel') : t('offLabel')}`}
                style={iconBtn}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: 0.4, lineHeight: 1,
                    padding: '3px 4px', borderRadius: 4, border: '1.6px solid currentColor',
                    opacity: captionsEnabled ? 1 : 0.72,
                    boxShadow: captionsEnabled ? 'inset 0 -3px 0 var(--brand)' : 'none',
                  }}
                >
                  CC
                </span>
              </button>
            )}
            {!compact && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => { if (v) setSettingsView('main'); return !v; }); }}
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              style={{ ...iconBtn, fontSize: 18 }}
            >
              ⋮
            </button>
            )}

            {settingsOpen && !compact && (
              <div className="player-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                {settingsView === 'main' && (
                  <div className="player-menu-list">
                    {hasCaptions && (
                      <MenuRow icon="quote" label={t('captionsMenuLabel')} value={captionsEnabled ? t('onLabel') : t('offLabel')} onClick={onToggleCaptions} />
                    )}
                    {hasCaptions && captionsEnabled && (
                      <MenuRow icon="quote" label={t('captionSizeLabel')} value={t(captionSize === 's' ? 'captionSizeSmall' : captionSize === 'l' ? 'captionSizeLarge' : 'captionSizeMedium')} chevron onClick={() => setSettingsView('captions')} />
                    )}
                    <MenuRow icon="timer" label={t('sleepTimerMenuLabel')} value={sleepMinutes ? `${sleepMinutes} ${t('minutesShortLabel')}` : t('offLabel')} chevron onClick={() => setSettingsView('sleep')} />
                    {qualities.length <= 1 && dataSaver && (
                      <MenuRow
                        className="player-quality-btn"
                        icon="quality"
                        label={t('playerQualityMenu')}
                        value={dataSaver.light ? t('playbackLightOn') : t('playbackLightOff')}
                        onClick={() => {
                          dataSaver.onToggle();
                          setSettingsOpen(false);
                          setSettingsView('main');
                        }}
                      />
                    )}
                    {qualities.length > 1 && onQuality && (
                      <MenuRow
                        className="player-quality-btn"
                        icon="quality"
                        label={t('playerQualityMenu')}
                        value={quality >= 0 ? qualityLabel(qualities.find((q) => q.index === quality)?.height) : `${t('playerQualityAuto')}${playingHeight ? ` (${qualityLabel(playingHeight)})` : ''}`}
                        chevron
                        onClick={() => setSettingsView('quality')}
                      />
                    )}
                    <MenuRow icon="gauge" label={t('playbackSpeedLabel')} value={`${speed}x`} chevron onClick={() => setSettingsView('speed')} />
                    {onToggleLoop && <MenuRow icon="refresh" label={t('playerLoopLabel')} value={loop ? t('onLabel') : t('offLabel')} onClick={onToggleLoop} />}
                    {onToggleAutoplay && <MenuRow icon="play" label={t('playerAutoplayLabel')} value={autoplay ? t('onLabel') : t('offLabel')} onClick={onToggleAutoplay} />}
                    {onToggleStats && (
                      <MenuRow
                        className="player-stats-btn"
                        icon="chart"
                        label={t('playerStatsMenu')}
                        onClick={() => {
                          setSettingsOpen(false);
                          setSettingsView('main');
                          onToggleStats();
                        }}
                      />
                    )}
                    {/* Přehled zkratek (components/KeyboardShortcuts.tsx) - pro
                        toho, kdo "?" nezná. Na dotyku klávesnice není. */}
                    {!touchUi && (
                      <MenuRow
                        icon="keyboard"
                        label={t('shortcutsTitle')}
                        value="?"
                        onClick={() => {
                          setSettingsOpen(false);
                          window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
                        }}
                      />
                    )}
                  </div>
                )}

                {settingsView === 'quality' && (
                  <div>
                    <button type="button" className="player-menu-back" onClick={() => setSettingsView('main')}>
                      <UiIcon name="chevronLeft" size={16} />
                      {t('playerQualityMenu')}
                    </button>
                    <div role="radiogroup" aria-label={t('playerQualityMenu')} className="player-menu-list">
                      {[{ index: -1, label: t('playerQualityAuto') }, ...qualities.map((q) => ({ index: q.index, label: qualityLabel(q.height) }))].map((option) => (
                        <button
                          key={option.index}
                          type="button"
                          role="radio"
                          aria-checked={quality === option.index}
                          className="player-menu-row player-quality-option"
                          onClick={() => {
                            onQuality?.(option.index);
                            setSettingsOpen(false);
                            setSettingsView('main');
                          }}
                        >
                          <span className="player-menu-label">{option.label}</span>
                          {quality === option.index && <span className="player-menu-value"><UiIcon name="check" size={15} /></span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {settingsView === 'speed' && (
                  <div>
                    <button type="button" className="player-menu-back" onClick={() => setSettingsView('main')}>
                      <UiIcon name="chevronLeft" size={16} />
                      {t('playbackSpeedLabel')}
                    </button>
                    <div className="player-menu-chips" role="radiogroup" aria-label={t('playbackSpeedLabel')}>
                      {[0.25, 0.5, 1, 1.5, 2, 3, 5].map((rate) => (
                        <button key={rate} type="button" role="radio" aria-checked={speed === rate} className={`player-menu-chip${speed === rate ? ' active' : ''}`} onClick={() => handleSpeedChange(rate)}>
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {settingsView === 'captions' && (
                  <div>
                    <button type="button" className="player-menu-back" onClick={() => setSettingsView('main')}>
                      <UiIcon name="chevronLeft" size={16} />
                      {t('captionSizeLabel')}
                    </button>
                    <div className="player-menu-chips" role="radiogroup" aria-label={t('captionSizeLabel')}>
                      {(['s', 'm', 'l'] as const).map((size) => (
                        <button key={size} type="button" role="radio" aria-checked={captionSize === size} className={`player-menu-chip${captionSize === size ? ' active' : ''}`} onClick={() => { setCaptionSize(size); saveCaptionSize(size); }}>
                          {t(size === 's' ? 'captionSizeSmall' : size === 'l' ? 'captionSizeLarge' : 'captionSizeMedium')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {settingsView === 'sleep' && (
                  <div>
                    <button type="button" className="player-menu-back" onClick={() => setSettingsView('main')}>
                      <UiIcon name="chevronLeft" size={16} />
                      {t('sleepTimerMenuLabel')}
                    </button>
                    <div className="player-menu-chips" role="radiogroup" aria-label={t('sleepTimerMenuLabel')}>
                      {[null, 15, 30, 60].map((m) => (
                        <button key={m ?? 'off'} type="button" role="radio" aria-checked={sleepMinutes === m} className={`player-menu-chip${sleepMinutes === m ? ' active' : ''}`} onClick={() => handleSleepTimer(m)}>
                          {m ? `${m} ${t('minutesShortLabel')}` : t('offLabel')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {pipOk && !compact && (
              <button
                onClick={(e) => { e.stopPropagation(); togglePictureInPicture(player); }}
                type="button"
                className="player-pip-btn"
                title={pipOn ? t('playerPipOff') : t('playerPipOn')}
                aria-label={pipOn ? t('playerPipOff') : t('playerPipOn')}
                aria-pressed={pipOn}
                style={iconBtn}
              >
                <svg width="20" height="16" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="1.5" y="2" width="21" height="14" rx="2" />
                  <rect x="12" y="9" width="8" height="5" rx="1" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )}
            {onToggleTheater && !compact && !isMaximized && !touchUi && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleTheater(); }}
                type="button"
                className="player-theater-btn"
                title={theater ? t('playerTheaterOff') : t('playerTheaterOn')}
                aria-label={theater ? t('playerTheaterOff') : t('playerTheaterOn')}
                aria-pressed={!!theater}
                style={iconBtn}
              >
                <svg width="20" height="16" viewBox="0 0 24 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  {theater ? <rect x="4" y="4" width="16" height="10" rx="1.5" /> : <rect x="1.5" y="2" width="21" height="14" rx="2" />}
                </svg>
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMaximize(); }}
              type="button"
              title={isMaximized ? t('playerFullscreenOff') : t('playerFullscreenOn')}
              aria-label={isMaximized ? t('playerFullscreenOff') : t('playerFullscreenOn')}
              style={iconBtn}
            >
              {isMaximized ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
