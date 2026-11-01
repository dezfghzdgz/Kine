'use client';

/**
 * Napojení HLS zdroje na <audio>/<video> (lib/musicPlayer.tsx).
 *
 * Safari umí HLS nativně - stačí src. Ostatní prohlížeče (Chrome, Edge,
 * Firefox, televize) potřebují hls.js, které HLS rozebere a krmí jím
 * prohlížeč přes Media Source Extensions (Chrome na Androidu HLS umí, ale
 * videa i tak hrají přes hls.js - viz prefersNativeHls). hls.js se
 * stahuje až když je potřeba (jen mimo Safari, jen když hraje hudba) -
 * a předem "na dálku", ať je v ruce ve chvíli, kdy divák klikne: napojení
 * pak proběhne ještě v tom samém kliknutí, které prohlížeč bere jako
 * svolení pustit zvuk.
 */

export type Detach = () => void;

let nativeHlsMemo: boolean | null = null;
let preferNativeMemo: boolean | null = null;

/**
 * Umí prohlížeč HLS sám? Safari na iPhonu, iPadu i Macu - ale taky Chrome
 * na Androidu (odjakživa) a nově i Chrome na počítači.
 *
 * Tohle rozhoduje jen o hudbě (lib/musicPlayer.tsx: <audio>, které hraje
 * i se zamčenou obrazovkou). Videa se řídí prefersNativeHls.
 */
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

/**
 * Hrát videa přes HLS prohlížeče (true), nebo přes hls.js (false)?
 *
 * Prohlížeč jen u Apple (Safari na Macu, iPhone, iPad - tam je jeho
 * přehrávač nejlepší) a tam, kde hls.js nejde (bez Media Source
 * Extensions). Chrome na Androidu a nově i na počítači HLS taky hlásí -
 * jenže kvalitu si pak volí sám, bez nabídky kvality a bez stropu podle
 * velikosti přehrávače, takže video bývalo rozmazané i na dobrém
 * internetu. Tam teď hraje hls.js (lib/vodPlayer.ts).
 */
export function prefersNativeHls(): boolean {
  if (preferNativeMemo !== null) return preferNativeMemo;
  if (typeof window === 'undefined') return false;
  if (!supportsNativeHls()) {
    preferNativeMemo = false;
    return false;
  }
  try {
    const w = window as any;
    const mse = !!(w.MediaSource || w.ManagedMediaSource || w.WebKitMediaSource);
    const apple = /apple/i.test(typeof navigator !== 'undefined' ? navigator.vendor || '' : '');
    preferNativeMemo = apple || !mse;
  } catch {
    preferNativeMemo = true;
  }
  return preferNativeMemo;
}

let HlsCtor: any = null;
let hlsLoading: Promise<any> | null = null;

/** Stáhne hls.js dopředu (kromě Apple, kde videa hraje prohlížeč sám). Bez čekání, bez chyby navenek. */
export function preloadHls(): Promise<any> {
  if (HlsCtor) return Promise.resolve(HlsCtor);
  if (prefersNativeHls()) return Promise.resolve(null);
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

/** hls.js u napojených prvků (kvůli omezení kvality obrazu) a prvky, které mají mít obraz co nejlevnější. */
const instances = new WeakMap<HTMLMediaElement, any>();
const lowVideo = new WeakSet<HTMLMediaElement>();

/**
 * Obraz v nejnižší kvalitě (true), nebo zase podle sítě (false).
 *
 * Hudba na obal (obraz není vidět) a dopředu načítaná další skladba
 * nepotřebují 1080p - stahovalo by se několikanásobně víc dat jen pro zvuk.
 * Na pomalé síti to navíc bralo pásmo tomu, co je opravdu vidět. Platí pro
 * hls.js; Safari (nativní HLS) si kvalitu řídí samo.
 */
export function setLowVideo(el: HTMLMediaElement | null | undefined, low: boolean): void {
  if (!el) return;
  if (low) lowVideo.add(el);
  else lowVideo.delete(el);
  const hls = instances.get(el);
  if (!hls) return;
  try {
    hls.autoLevelCapping = low ? 0 : -1;
  } catch {
    /* zničené mezitím */
  }
}

export type AttachOptions = {
  /** Přehrávání nejde a nepůjde (hls.js chybí, nebo osudová chyba). */
  onFatal?: (why: string) => void;
  /** Zdroj je napojený - teprve teď má smysl volat play(). */
  onReady?: () => void;
  /**
   * Odkud začít (vteřiny) - skladba předaná z režimu Video naváže tam, kde video bylo.
   * hls.js načte rovnou ten kus (ne začátek a pak skok), Safari skočí po načtení údajů.
   */
  startAt?: number | null;
};

/**
 * Napojí HLS adresu na element. Vrací úklid, který napojení zase zruší
 * (při výměně skladby, zavření přehrávače).
 */
export function attachHls(el: HTMLMediaElement, url: string, options: AttachOptions = {}): Detach {
  const startAt = typeof options.startAt === 'number' && Number.isFinite(options.startAt) && options.startAt > 0 ? options.startAt : null;
  if (supportsNativeHls()) {
    // Safari: začátek jde nastavit, až prvek zná délku.
    const onMeta = () => {
      if (startAt === null || Math.abs(el.currentTime - startAt) <= 1) return;
      try {
        el.currentTime = startAt;
      } catch {
        // Ještě nejde - hraje se od začátku, nic se nerozbije.
      }
    };
    if (startAt !== null) el.addEventListener('loadedmetadata', onMeta, { once: true });
    el.src = url;
    options.onReady?.();
    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
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
      // Obraz nikdy větší, než je vidět (malé okno / telefon = menší kvalita, méně dat).
      capLevelToPlayerSize: true,
      startPosition: startAt ?? -1,
    });
    instances.set(el, hls);
    if (lowVideo.has(el)) hls.autoLevelCapping = 0;
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
    if (instances.get(el) === hls) instances.delete(el);
    try { hls?.destroy(); } catch { /* už zničené */ }
    hls = null;
  };
}
