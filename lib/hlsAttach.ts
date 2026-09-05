'use client';

/**
 * Napojení HLS zdroje na <audio>/<video> (lib/musicPlayer.tsx).
 *
 * Safari umí HLS nativně - stačí src. Ostatní prohlížeče (Chrome, Edge,
 * Firefox, Android, televize) ho neumějí a potřebují hls.js, které HLS
 * rozebere a krmí jím prohlížeč přes Media Source Extensions. hls.js se
 * stahuje až když je potřeba (jen mimo Safari, jen když hraje hudba) -
 * a předem "na dálku", ať je v ruce ve chvíli, kdy divák klikne: napojení
 * pak proběhne ještě v tom samém kliknutí, které prohlížeč bere jako
 * svolení pustit zvuk.
 */

export type Detach = () => void;

let nativeHlsMemo: boolean | null = null;

/** Umí prohlížeč HLS sám? (Safari na iPhonu, iPadu i Macu.) */
export function supportsNativeHls(): boolean {
  if (nativeHlsMemo !== null) return nativeHlsMemo;
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('video');
    nativeHlsMemo = typeof probe.canPlayType === 'function' && probe.canPlayType('application/vnd.apple.mpegurl') !== '';
  } catch {
    nativeHlsMemo = false;
  }
  return nativeHlsMemo;
}

let HlsCtor: any = null;
let hlsLoading: Promise<any> | null = null;

/** Stáhne hls.js dopředu (mimo Safari). Bez čekání, bez chyby navenek. */
export function preloadHls(): Promise<any> {
  if (HlsCtor) return Promise.resolve(HlsCtor);
  if (supportsNativeHls()) return Promise.resolve(null);
  if (!hlsLoading) {
    hlsLoading = import('hls.js')
      .then((mod) => {
        HlsCtor = mod.default;
        return HlsCtor;
      })
      .catch(() => {
        hlsLoading = null;
        return null;
      });
  }
  return hlsLoading;
}

export type AttachOptions = {
  /** Přehrávání nejde a nepůjde (hls.js chybí, nebo osudová chyba). */
  onFatal?: (why: string) => void;
  /** Zdroj je napojený - teprve teď má smysl volat play(). */
  onReady?: () => void;
};

/**
 * Napojí HLS adresu na element. Vrací úklid, který napojení zase zruší
 * (při výměně skladby, zavření přehrávače).
 */
export function attachHls(el: HTMLMediaElement, url: string, options: AttachOptions = {}): Detach {
  if (supportsNativeHls()) {
    el.src = url;
    options.onReady?.();
    return () => {
      el.removeAttribute('src');
      try { el.load(); } catch { /* prohlížeč bez load() - není co uklízet */ }
    };
  }

  let hls: any = null;
  let cancelled = false;

  function start(Hls: any) {
    if (cancelled || !Hls) {
      if (!Hls && !cancelled) options.onFatal?.('hls.js se nenačetlo');
      return;
    }
    if (!Hls.isSupported()) {
      options.onFatal?.('prohlížeč neumí Media Source Extensions');
      return;
    }
    hls = new Hls({
      // Kratší vyrovnávací paměť za přehrávanou pozicí šetří paměť
      // telefonu; dopředu si hls.js bere výchozích 30 s.
      backBufferLength: 30,
      enableWorker: true,
    });
    hls.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
      if (!data?.fatal) return;
      // Standardní záchrana z dokumentace hls.js: síť zkusit znovu, chybu
      // dekodéru nechat opravit; jinak je to konec.
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else options.onFatal?.(String(data.details ?? 'hls fatal'));
    });
    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      if (!cancelled) options.onReady?.();
    });
    hls.loadSource(url);
    hls.attachMedia(el);
  }

  if (HlsCtor) start(HlsCtor);
  else preloadHls().then(start);

  return () => {
    cancelled = true;
    try { hls?.destroy(); } catch { /* už zničené */ }
    hls = null;
  };
}
