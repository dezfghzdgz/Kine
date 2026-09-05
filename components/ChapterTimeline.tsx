'use client';

import { useEffect, useRef, useState } from 'react';
import { SpeakerIcon, MaximizeIcon, MinimizeIcon } from './ReactionIcons';
import { useLanguage } from '@/lib/i18n';
import { PlayIcon, PauseIcon } from './MusicIcons';
import { AUTO_HIDE_MS, clampSeek, decideTap, formatTime, tapSide, type Tap, type TapSide } from '@/lib/playerControls';

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
}: {
  chapters: Chapter[];
  duration: number;
  player: any;
  hasCaptions?: boolean;
  captionsEnabled?: boolean;
  onToggleCaptions?: () => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
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
  const [settingsView, setSettingsView] = useState<'main' | 'speed' | 'sleep'>('main');
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
      draggingRef.current = null;
      setIsDragging(false);
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

  function showControlsTemporarily() {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      // Na celou obrazovku se ovládání schovává úplně stejně jako v okně -
      // dřív tam zůstávalo natrvalo viset přes video.
      if (player && !player.paused) setControlsVisible(false);
    }, AUTO_HIDE_MS);
  }

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
    setHoverTitle(segmentTitleAt(seconds));
  }

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
      showControlsTemporarily();
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
      showControlsTemporarily();
      return;
    }

    if (controlsVisible && !paused) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      setControlsVisible(false);
    } else {
      showControlsTemporarily();
    }
  }

  // Tlačítka lišty: na dotyku aspoň 44 px, myši stačí 36. Ikony zůstávají
  // stejné, roste jen plocha, na kterou se dá trefit.
  const hit = touchUi ? 44 : 36;
  const iconBtn: React.CSSProperties = {
    background: 'none', border: 'none', color: '#fff', padding: 0, cursor: 'pointer',
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
        onMouseMove={showControlsTemporarily}
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
          className={`player-center-toggle ${controlsVisible ? '' : 'player-center-toggle-hidden'}`}
          aria-label={paused ? t('playerPlay') : t('playerPause')}
          onClick={(e) => { e.stopPropagation(); togglePlay(); showControlsTemporarily(); }}
        >
          {paused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
        </button>
      )}

      <div
        ref={wrapRef}
        onMouseMove={(e) => { e.stopPropagation(); showControlsTemporarily(); }}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 5,
          background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))',
          // Na iPhonu v celé obrazovce sedí dole ukazatel domů a po stranách
          // výřez - lišta se jim vyhne. Bez viewport-fit=cover v layoutu jsou
          // ty hodnoty nula (viz app/layout.tsx).
          padding: '20px calc(14px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) calc(14px + env(safe-area-inset-left, 0px))',
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
          onMouseLeave={() => setHoverTitle(null)}
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
            <span style={{ fontSize: 12, opacity: 0.85, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {total > 0 ? `${formatTime(current)} / ${formatTime(total)}` : formatTime(current)}
            </span>
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
          </div>

          <div ref={settingsRef} style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 2, position: 'relative' }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSettingsOpen((v) => { if (v) setSettingsView('main'); return !v; }); }}
              aria-haspopup="menu"
              aria-expanded={settingsOpen}
              style={{ ...iconBtn, fontSize: 18 }}
            >
              ⋮
            </button>

            {settingsOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, width: 200,
                  background: 'rgba(20,20,22,0.95)', borderRadius: 8, padding: 10,
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                {settingsView === 'main' && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {hasCaptions && (
                      <button
                        onClick={onToggleCaptions}
                        style={{
                          display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none',
                          color: '#fff', padding: '7px 4px', cursor: 'pointer', fontSize: 12.5,
                        }}
                      >
                        <span>{t('captionsMenuLabel')}</span>
                        <span style={{ color: 'rgba(255,255,255,0.6)' }}>{captionsEnabled ? t('onLabel') : t('offLabel')}</span>
                      </button>
                    )}
                    <button
                      onClick={() => setSettingsView('sleep')}
                      style={{
                        display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none',
                        color: '#fff', padding: '7px 4px', cursor: 'pointer', fontSize: 12.5,
                      }}
                    >
                      <span>{t('sleepTimerMenuLabel')}</span>
                      <span style={{ color: 'rgba(255,255,255,0.6)' }}>{sleepMinutes ? `${sleepMinutes} ${t('minutesShortLabel')}` : t('offLabel')}</span>
                    </button>
                    <button
                      onClick={() => setSettingsView('speed')}
                      style={{
                        display: 'flex', justifyContent: 'space-between', background: 'none', border: 'none',
                        color: '#fff', padding: '7px 4px', cursor: 'pointer', fontSize: 12.5,
                      }}
                    >
                      <span>{t('playbackSpeedLabel')}</span>
                      <span style={{ color: 'rgba(255,255,255,0.6)' }}>{speed}x</span>
                    </button>
                  </div>
                )}

                {settingsView === 'speed' && (
                  <div>
                    <button
                      onClick={() => setSettingsView('main')}
                      style={{ background: 'none', border: 'none', color: '#fff', padding: '4px 4px 8px', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%' }}
                    >
                      {t('backButton')}
                    </button>
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

                {settingsView === 'sleep' && (
                  <div>
                    <button
                      onClick={() => setSettingsView('main')}
                      style={{ background: 'none', border: 'none', color: '#fff', padding: '4px 4px 8px', cursor: 'pointer', fontSize: 12, textAlign: 'left', width: '100%' }}
                    >
                      {t('backButton')}
                    </button>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {[null, 15, 30, 60].map((m) => (
                        <button
                          key={m ?? 'off'}
                          onClick={() => handleSleepTimer(m)}
                          style={{
                            background: sleepMinutes === m ? '#fff' : 'rgba(255,255,255,0.12)',
                            color: sleepMinutes === m ? '#0a0a0b' : '#fff',
                            border: 'none', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                          }}
                        >
                          {m ? `${m} ${t('minutesShortLabel')}` : t('offLabel')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
