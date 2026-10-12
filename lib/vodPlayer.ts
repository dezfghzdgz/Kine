'use client';

import { preloadHls, supportsNativeHls } from './hlsAttach';
import { fragmentSample, qualityOptions, startEstimate, type FragmentSample, type QualityLevel } from './vodPlayerCore';
import { fingerprintOf } from './errorReporter';
import { detectDeviceClass } from './deviceClass';

/**
 * Vlastní přehrávač videí na stránce videa: <video> + HLS od Cloudflare
 * (Safari sám, ostatní přes hls.js). Proč a co umí: lib/vodPlayerCore.ts.
 */

const BANDWIDTH_KEY = 'kine-vod-bandwidth';

function rememberedBandwidth(): number | null {
  try {
    const n = Number(localStorage.getItem(BANDWIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function rememberBandwidth(bps: number): void {
  try {
    if (Number.isFinite(bps) && bps > 0) localStorage.setItem(BANDWIDTH_KEY, String(Math.round(bps)));
  } catch {
    // Bez úložiště se příště začne s výchozím odhadem.
  }
}

/** Umí prohlížeč vlastní přehrávač? (HLS sám, nebo Media Source Extensions pro hls.js) */
export function canPlayVodNatively(): boolean {
  if (typeof window === 'undefined') return false;
  if (supportsNativeHls()) return true;
  const w = window as any;
  return !!(w.MediaSource || w.ManagedMediaSource || w.WebKitMediaSource);
}

export type VodStats = {
  engine: 'hls.js' | 'native';
  host: string;
  /** performance.now() při napojení. */
  attachedAt: number;
  /** performance.now() první žádosti o přehrání (událost play) - od ní se počítá rozjezd; null = ještě ne (čeká se na klepnutí). */
  playRequestedAt: number | null;
  /** Karta byla na pozadí dřív, než se video rozjelo (prohlížeč ho schválně nepouští) - takový rozjezd se nehlásí. */
  hiddenBeforeStart: boolean;
  manifestMs: number | null;
  /** Rozjezd: od žádosti o přehrání po první snímek. */
  firstFrameMs: number | null;
  firstFragment: FragmentSample | null;
  recent: FragmentSample[];
  height: number | null;
  bitrateKbps: number | null;
  bandwidthKbps: number | null;
  stalls: number;
  retries: number;
  lastError: string | null;
};

export type VodHandle = {
  stats: VodStats;
  /** Nabídka kvality (prázdná u Safari - ten kvalitu volí sám). */
  levels: () => QualityLevel[];
  /** Zvolená kvalita: index úrovně, -1 = automaticky. */
  quality: () => number;
  setQuality: (index: number) => void;
  /** Kolik vteřin dopředu stahovat a nejvýš kolik (přednačtené video, které se právě začalo přehrávat: víc). Safari si to řídí sám. */
  setBufferAhead: (seconds: number, capSeconds?: number) => void;
  detach: () => void;
};

export type VodOptions = {
  /** Odkud začít (pokračování, ?t= z odkazu); null = od začátku. */
  startAt: number | null;
  /** Nejde to (hls.js / MSE chybí, osudová chyba) - stránka přepne na iframe Cloudflare od `at` vteřin. */
  onFatal: (why: string, at: number) => void;
  /** Změnila se nabídka kvality nebo právě hraná kvalita. */
  onLevels?: () => void;
  /**
   * Kolik vteřin dopředu stahovat (výchozí 30) a nejvýš kolik (bufferCap,
   * výchozí 120 - hls.js u nízké kvality stahuje dál až po tenhle strop).
   * Přednačítané video (Sparks: další v řadě) jen pár vteřin s pevným
   * stropem - první kus, ať se po přejetí rozjede hned a nebere data tomu,
   * co právě hraje. Za běhu se mění setBufferAhead.
   */
  bufferAhead?: number;
  bufferCap?: number;
  /** Kolik vteřin za sebou držet (výchozí 30). Krátká videa ve smyčce (Sparks) celé - smyčka pak nic nestahuje znovu. */
  backBuffer?: number;
};

/** Safari (HLS sám) se nedá říct "jen 4 s dopředu" - u přednačítaného videa aspoň preload=metadata. */
function nativePreload(capSeconds: number): 'auto' | 'metadata' {
  return capSeconds <= 10 ? 'metadata' : 'auto';
}

/** Načítání: zaseknutý kus se zkusí znovu po pár vteřinách, ne až po dvou minutách (výchozí hls.js). */
const FRAGMENT_POLICY = {
  default: {
    maxTimeToFirstByteMs: 8000,
    maxLoadTimeMs: 45000,
    timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 6, retryDelayMs: 500, maxRetryDelayMs: 4000, backoff: 'linear' as const },
  },
};
const PLAYLIST_POLICY = {
  default: {
    maxTimeToFirstByteMs: 8000,
    maxLoadTimeMs: 15000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 3, retryDelayMs: 500, maxRetryDelayMs: 3000, backoff: 'linear' as const },
  },
};

/**
 * Napojí video (HLS adresa) na <video>. Vrací ovládání kvality, statistiky
 * a úklid (při výměně videa, odchodu ze stránky, přepnutí na iframe).
 */
export function attachVod(video: HTMLVideoElement, url: string, options: VodOptions): VodHandle {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }
  const stats: VodStats = {
    engine: supportsNativeHls() ? 'native' : 'hls.js',
    host,
    attachedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    playRequestedAt: null,
    hiddenBeforeStart: typeof document !== 'undefined' && document.visibilityState !== 'visible',
    manifestMs: null,
    firstFrameMs: null,
    firstFragment: null,
    recent: [],
    height: null,
    bitrateKbps: null,
    bandwidthKbps: null,
    stalls: 0,
    retries: 0,
    lastError: null,
  };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const startAt = options.startAt && options.startAt > 0 ? options.startAt : null;
  let bufferAhead = options.bufferAhead && options.bufferAhead > 0 ? options.bufferAhead : 30;
  let bufferCap = options.bufferCap && options.bufferCap > 0 ? Math.max(options.bufferCap, bufferAhead) : Math.max(120, bufferAhead);

  let hls: any = null;
  let destroyed = false;
  let fatalSent = false;
  let levels: QualityLevel[] = [];
  let mediaRecoveries = 0;
  let networkRecoveries = 0;

  // Po přetočení a ruční změně kvality se chvíli načítá schválně - to není zaseknutí.
  let quietUntil = 0;
  const onPlay = () => {
    if (stats.playRequestedAt === null) stats.playRequestedAt = now();
  };
  const onPlaying = () => {
    if (stats.firstFrameMs === null) stats.firstFrameMs = Math.round(now() - (stats.playRequestedAt ?? stats.attachedAt));
  };
  const onWaiting = () => {
    if (stats.firstFrameMs !== null && !video.seeking && now() > quietUntil) stats.stalls += 1;
  };
  const onSeeking = () => {
    quietUntil = now() + 3000;
  };
  const onResize = () => {
    if (stats.engine === 'native' && video.videoHeight > 0) stats.height = video.videoHeight;
  };
  const onVisibility = () => {
    if (stats.firstFrameMs === null && document.visibilityState !== 'visible') stats.hiddenBeforeStart = true;
  };
  video.addEventListener('play', onPlay);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('waiting', onWaiting);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  function fatal(why: string) {
    if (fatalSent || destroyed) return;
    fatalSent = true;
    stats.lastError = why;
    const at = Number.isFinite(video.currentTime) && video.currentTime > 1 ? video.currentTime : startAt ?? 0;
    options.onFatal(why, at);
  }

  let nativeCleanup: (() => void) | null = null;

  if (stats.engine === 'native') {
    // Safari: HLS umí sám. Začátek se nastaví, jakmile zná délku videa.
    const onMeta = () => {
      if (startAt && Math.abs(video.currentTime - startAt) > 1) {
        try {
          video.currentTime = startAt;
        } catch {
          // Ještě nejde - přehrávání pak začne od začátku, nic se nerozbije.
        }
      }
    };
    const onError = () => fatal(`native-hls ${video.error?.code ?? ''}`.trim());
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onError);
    // Safari si o tom, kolik stáhnout dopředu, rozhoduje sám - u přednačítaného videa
    // (malý strop) aspoň jen začátek a údaje, ať nebere data tomu, co právě hraje.
    video.preload = nativePreload(bufferCap);
    video.src = url;
    nativeCleanup = () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // není co uklízet
      }
    };
  } else {
    preloadHls().then((Hls) => {
      if (destroyed) return;
      if (!Hls) return fatal('hls.js se nenačetlo');
      if (!Hls.isSupported()) return fatal('bez Media Source Extensions');
      hls = new Hls({
        enableWorker: true,
        startPosition: startAt ?? -1,
        // První kus podle odhadu připojení (malý), pak hls.js kvalitu sám zvedne.
        startLevel: -1,
        testBandwidth: false,
        abrEwmaDefaultEstimate: startEstimate(rememberedBandwidth()),
        // Do malého okna se nestahuje 1080p; na celé obrazovce kvalita vyskočí.
        capLevelToPlayerSize: true,
        maxBufferLength: bufferAhead,
        maxMaxBufferLength: bufferCap,
        backBufferLength: options.backBuffer ?? 30,
        fragLoadPolicy: FRAGMENT_POLICY,
        manifestLoadPolicy: PLAYLIST_POLICY,
        playlistLoadPolicy: PLAYLIST_POLICY,
      });
      const E = Hls.Events;
      hls.on(E.MANIFEST_LOADED, (_e: unknown, data: any) => {
        const l = data?.stats?.loading;
        if (l && Number.isFinite(l.end - l.start)) stats.manifestMs = Math.round(l.end - l.start);
      });
      hls.on(E.MANIFEST_PARSED, () => {
        levels = qualityOptions(hls?.levels ?? []);
        options.onLevels?.();
      });
      hls.on(E.LEVEL_SWITCHED, (_e: unknown, data: any) => {
        const level = hls?.levels?.[data?.level];
        stats.height = level?.height ?? null;
        stats.bitrateKbps = level?.bitrate ? Math.round(level.bitrate / 1000) : null;
        options.onLevels?.();
      });
      hls.on(E.FRAG_LOADED, (_e: unknown, data: any) => {
        const frag = data?.frag;
        if (!frag || frag.type !== 'main') return;
        const sample = fragmentSample(frag.stats, hls?.levels?.[frag.level]?.height ?? 0, frag.duration);
        if (!sample) return;
        if (!stats.firstFragment) stats.firstFragment = sample;
        stats.recent = [...stats.recent.slice(-5), sample];
        const bw = Number(hls?.bandwidthEstimate);
        if (Number.isFinite(bw) && bw > 0) {
          stats.bandwidthKbps = Math.round(bw / 1000);
          // Příště se začne podle tohohle (lib/vodPlayerCore.ts - startEstimate).
          if (stats.recent.length >= 2) rememberBandwidth(bw);
        }
      });
      hls.on(E.ERROR, (_e: unknown, data: any) => {
        const details = String(data?.details ?? data?.type ?? 'hls');
        if (!data?.fatal) {
          // Opakované načtení (timeout, výpadek) - hls.js to zkouší sám, jen se to počítá do statistik.
          if (/timeout|error/i.test(details)) stats.retries += 1;
          stats.lastError = details;
          return;
        }
        stats.lastError = details;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
          mediaRecoveries += 1;
          if (mediaRecoveries === 2) hls.swapAudioCodec?.();
          hls.recoverMediaError();
          return;
        }
        // Síť po rozjezdu: zkusit znovu načítat (výpadek wifi); před rozjezdem rovnou na Cloudflare.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && stats.firstFrameMs !== null && networkRecoveries < 2) {
          networkRecoveries += 1;
          hls.startLoad();
          return;
        }
        fatal(`hls ${details}`);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    });
  }

  return {
    stats,
    levels: () => levels,
    quality: () => {
      if (!hls) return -1;
      return hls.autoLevelEnabled ? -1 : Number(hls.manualLevel ?? -1);
    },
    setQuality: (index: number) => {
      if (!hls) return;
      quietUntil = now() + 4000;
      if (Number.isInteger(index) && index >= 0 && index < (hls.levels?.length ?? 0)) {
        // Zvolená kvalita hned (stáhne se znovu kus, který právě hraje).
        hls.currentLevel = index;
      } else {
        // Automaticky: od dalšího kusu, bez zahození načteného (currentLevel = -1 by ho zahodil).
        hls.nextLevel = -1;
      }
      options.onLevels?.();
    },
    setBufferAhead: (seconds: number, capSeconds?: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      bufferAhead = seconds;
      bufferCap = capSeconds && capSeconds > 0 ? Math.max(capSeconds, seconds) : Math.max(120, seconds);
      // hls.js čte nastavení při každém kroku načítání - změna platí hned (i před napojením: viz Hls výše).
      if (hls?.config) {
        hls.config.maxBufferLength = bufferAhead;
        hls.config.maxMaxBufferLength = bufferCap;
      }
      if (stats.engine === 'native' && !destroyed) video.preload = nativePreload(bufferCap);
    },
    detach: () => {
      destroyed = true;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      const bw = Number(hls?.bandwidthEstimate);
      if (Number.isFinite(bw) && bw > 0 && stats.recent.length >= 2) rememberBandwidth(bw);
      try {
        hls?.destroy();
      } catch {
        // už zničené
      }
      hls = null;
      nativeCleanup?.();
      nativeCleanup = null;
    },
  };
}

/**
 * <video> převlečený za přehrávač Cloudflare (stejné vlastnosti a události,
 * jaké stránka videa a ovládání používají - currentTime, paused, muted,
 * volume, duration, play(), pause()...). play() nikdy nevyhodí chybu do
 * prázdna: když prohlížeč přehrání bez klepnutí nedovolí, řekne to
 * onBlocked (stránka nabídne tlačítko Přehrát).
 */
export function mediaPlayer(video: HTMLVideoElement, onBlocked?: () => void) {
  return {
    element: video,
    get currentTime() {
      return video.currentTime;
    },
    set currentTime(value: number) {
      if (!Number.isFinite(value)) return;
      try {
        video.currentTime = Math.max(0, value);
      } catch {
        // Ještě nejde (bez metadat) - nic se nerozbije.
      }
    },
    get paused() {
      return video.paused;
    },
    get muted() {
      return video.muted;
    },
    set muted(value: boolean) {
      video.muted = !!value;
    },
    get volume() {
      return video.volume;
    },
    set volume(value: number) {
      if (Number.isFinite(value)) video.volume = Math.max(0, Math.min(1, value));
    },
    /** Délka, až ji video zná (jinak undefined - stejně jako přehrávač Cloudflare). */
    get duration() {
      return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
    },
    get ended() {
      return video.ended;
    },
    get loop() {
      return video.loop;
    },
    set loop(value: boolean) {
      video.loop = !!value;
    },
    get playbackRate() {
      return video.playbackRate;
    },
    set playbackRate(value: number) {
      if (Number.isFinite(value) && value > 0) video.playbackRate = value;
    },
    play(): Promise<void> {
      try {
        const p = video.play();
        return p
          ? p.catch((e: any) => {
              if (e?.name === 'NotAllowedError') onBlocked?.();
            })
          : Promise.resolve();
      } catch {
        return Promise.resolve();
      }
    },
    pause() {
      video.pause();
    },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      video.addEventListener(type, listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      video.removeEventListener(type, listener);
    },
  };
}

export type MediaPlayer = ReturnType<typeof mediaPlayer>;

/**
 * Pomalé video do /admin/errors (druh "perf"): technický souhrn statistik
 * (lib/vodPlayerCore.ts - statsReport). Stejné potíže se seskupí podle
 * příčiny (Cloudflare / připojení / čeká se).
 */
export function reportSlowVideo(report: string, verdict: string): void {
  if (typeof window === 'undefined') return;
  const message = `Pomalé video: ${verdict}`;
  const body = JSON.stringify({
    kind: 'perf',
    message,
    stack: report,
    url: `${window.location.origin}${window.location.pathname}`,
    userAgent: navigator.userAgent,
    device: detectDeviceClass(),
    fingerprint: fingerprintOf(message, null),
  });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/client-errors', new Blob([body], { type: 'application/json' }))) return;
  } catch {
    // spadne na fetch
  }
  fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
}
