'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import UiIcon from '@/components/UiIcon';
import { livePlayerSrc, stallAction, timeAdvanced } from '@/lib/livePlayback';

/** Přehrávač Cloudflare ovládaný přes jeho SDK (stejné jako na stránce videa). */
type SdkPlayer = {
  addEventListener: (event: string, fn: () => void) => void;
  removeEventListener: (event: string, fn: () => void) => void;
  play: () => Promise<void> | void;
  muted: boolean;
  paused: boolean;
  currentTime: number;
};

/**
 * Přehrávač živého vysílání. Iframe Cloudflare a k němu:
 *  - když prohlížeč nepustí zvuk bez kliknutí, přenos jede ztlumeně
 *    a nahoře je "Zapnout zvuk" (jako na Twitchi) - ne stojící obrázek,
 *  - hlídání zamrzlého obrazu: když čas přehrávače LIVE_STALL_MS neroste,
 *    přehrávač se načte znovu (lib/livePlayback.ts) - divák dřív viděl jen
 *    první snímek a nic se nedělo.
 * Bez SDK (zablokovaný skript) zůstane obyčejný iframe jako dřív.
 */
export default function LivePlayer({ url, title }: { url: string; title: string }) {
  const { t } = useLanguage();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<SdkPlayer | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [reload, setReload] = useState(0);
  const [autoMuted, setAutoMuted] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const watch = useRef({ lastProgressAt: Date.now(), lastReloadAt: 0, reloads: 0, lastTime: null as number | null, pausedByViewer: false });

  useEffect(() => {
    if (typeof (window as any).Stream === 'function') setSdkReady(true);
  }, []);

  // Jiný přenos (nová adresa): počítadla obnov od nuly.
  useEffect(() => {
    setReload(0);
    setRecovering(false);
    watch.current = { lastProgressAt: Date.now(), lastReloadAt: 0, reloads: 0, lastTime: null, pausedByViewer: false };
  }, [url]);

  // Napojení na přehrávač (po každém načtení iframu znovu).
  useEffect(() => {
    const iframe = iframeRef.current;
    const Stream = (window as any).Stream;
    if (!sdkReady || !iframe || typeof Stream !== 'function') return;
    let player: SdkPlayer;
    try {
      player = Stream(iframe) as SdkPlayer;
    } catch {
      return;
    }
    playerRef.current = player;
    const w = watch.current;
    w.lastProgressAt = Date.now();
    w.lastTime = null;
    w.pausedByViewer = false;
    let cancelled = false;

    const progressed = () => {
      w.lastProgressAt = Date.now();
      w.reloads = 0;
      setRecovering(false);
      setNeedsTap(false);
    };
    const onTime = () => {
      const now = Number(player.currentTime);
      if (timeAdvanced(w.lastTime, now)) progressed();
      if (Number.isFinite(now)) w.lastTime = now;
    };
    const onPlay = () => {
      w.pausedByViewer = false;
      w.lastProgressAt = Date.now();
    };
    const onPause = () => {
      w.pausedByViewer = true;
    };
    player.addEventListener('timeupdate', onTime);
    player.addEventListener('playing', onPlay);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);

    // Rozjet: se zvukem, a když ho prohlížeč bez kliknutí nepustí, ztlumeně (+ "Zapnout zvuk").
    const startMuted = async () => {
      try {
        player.muted = true;
        if (!cancelled) setAutoMuted(true);
        await player.play();
      } catch {
        if (cancelled) return;
        // Nejde ani ztlumeně: čeká se na klepnutí diváka - do té doby se přehrávač neobnovuje.
        w.pausedByViewer = true;
        setNeedsTap(true);
      }
    };
    const kick = window.setTimeout(async () => {
      // Hraje (SDK to ví jistě) = nic. Neznámý stav = zkusit play() (na běžící přehrávač nic neudělá).
      if (cancelled || player.paused === false) return;
      try {
        const result = player.play();
        if (result && typeof (result as Promise<void>).then === 'function') await result;
        // Starší SDK nevrací slib: přehrávač stojí dál = prohlížeč zvuk nepustil.
        window.setTimeout(() => {
          if (!cancelled && player.paused) void startMuted();
        }, 1200);
      } catch {
        if (!cancelled) void startMuted();
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(kick);
      player.removeEventListener('timeupdate', onTime);
      player.removeEventListener('playing', onPlay);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      if (playerRef.current === player) playerRef.current = null;
    };
  }, [sdkReady, url, reload]);

  // Hlídač zamrzlého obrazu (jen s SDK - bez něj není jak poznat, že obraz běží).
  useEffect(() => {
    if (!sdkReady) return;
    const timer = window.setInterval(() => {
      if (!playerRef.current) return;
      const w = watch.current;
      const action = stallAction({
        now: Date.now(),
        lastProgressAt: w.lastProgressAt,
        lastReloadAt: w.lastReloadAt,
        reloads: w.reloads,
        pausedByViewer: w.pausedByViewer,
        visible: document.visibilityState === 'visible',
      });
      if (action !== 'reload') return;
      w.reloads += 1;
      w.lastReloadAt = Date.now();
      w.lastProgressAt = Date.now();
      setRecovering(true);
      setNeedsTap(false);
      setReload((n) => n + 1);
    }, 2000);
    // Návrat do karty: čas na pozadí stál schválně (prohlížeč šetří) - počítat znovu.
    const onVisible = () => {
      if (document.visibilityState === 'visible') watch.current.lastProgressAt = Date.now();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sdkReady]);

  function unmute() {
    const player = playerRef.current;
    setAutoMuted(false);
    if (!player) return;
    try {
      player.muted = false;
      if (player.paused) void Promise.resolve(player.play()).catch(() => undefined);
    } catch {
      // nic - divák si zvuk zapne v přehrávači
    }
  }

  function tapToPlay() {
    const player = playerRef.current;
    setNeedsTap(false);
    watch.current.pausedByViewer = false;
    watch.current.lastProgressAt = Date.now();
    if (!player) return;
    try {
      player.muted = false;
      setAutoMuted(false);
      void Promise.resolve(player.play()).catch(() => setNeedsTap(true));
    } catch {
      setNeedsTap(true);
    }
  }

  return (
    <div className="player-wrap live-player" style={{ aspectRatio: '16/9', position: 'relative' }}>
      <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" strategy="afterInteractive" onReady={() => setSdkReady(true)} />
      <iframe
        key={reload}
        ref={iframeRef}
        src={livePlayerSrc(url, reload)}
        style={{ width: '100%', height: '100%', border: 'none' }}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
        allowFullScreen
        title={title}
      />
      {autoMuted && !needsTap && (
        <button type="button" className="live-unmute-btn" onClick={unmute}>
          <UiIcon name="volume" size={16} />
          {t('liveUnmute')}
        </button>
      )}
      {needsTap && (
        // Vrstva přes celé video drží tlačítko uprostřed (globals.css .player-tap-layer).
        <div className="player-tap-layer">
          <button type="button" className="player-tap-to-play" onClick={tapToPlay}>
            <span className="player-tap-to-play-icon" aria-hidden="true" />
            {t('tapToPlay')}
          </button>
        </div>
      )}
      {recovering && (
        <div className="live-recovering" role="status">
          <span className="live-recovering-spin" aria-hidden="true" />
          {t('liveRecovering')}
        </div>
      )}
    </div>
  );
}
