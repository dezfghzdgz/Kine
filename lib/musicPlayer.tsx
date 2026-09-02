'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Hudba, která hraje dál i po odchodu ze stránky.
 *
 * Tohle je ta věc, kvůli které lidi chodí na YouTube Music: pustíš skladbu,
 * odejdeš prohlížet a hudba jede. Bez ní je "hudební režim" jenom jiný
 * vzhled.
 *
 * Proč to musí být tady a ne na stránce videa: přehrávač je cizí iframe od
 * Cloudflare. Jakmile ho Next.js při přechodu na jinou stránku odpojí,
 * zvuk utne - a při každé navigaci ho odpojí. Iframe proto žije jednou
 * provždy tady, v kostře appky, a stránky ho jen ovládají.
 *
 * Stavy jsou schválně dva:
 *   - příkazy (přehrát, další, hlasitost...) se nikdy nemění, takže
 *     komponenta, která si je vezme, se kvůli hudbě nepřekresluje
 *   - stav (čas, hraje/nehraje) tiká několikrát za vteřinu a berou si ho
 *     jen dvě malé komponenty: lišta dole a obal na stránce videa
 * Kdyby to bylo dohromady, překreslovala by se celá stránka videa čtyřikrát
 * za vteřinu.
 */

export type MusicTrack = {
  id: string;
  cloudflareId: string;
  title: string;
  creator: string | null;
  thumbnail: string | null;
  duration: number | null;
};

export type RepeatMode = 'off' | 'one' | 'all';

const REPEAT_KEY = 'kine-music-repeat';
const SHUFFLE_KEY = 'kine-music-shuffle';
const VOLUME_KEY = 'kine-music-volume';

type MusicCommands = {
  /** Načte skladbu. Když už hraje ta samá, nedělá nic - návrat na stránku ji nesmí spustit znovu. */
  openTrack: (track: MusicTrack, queue?: MusicTrack[]) => void;
  toggle: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Kolik už skladba hraje. Čte se z ref, takže si kvůli tomu nikdo nemusí brát tikající stav. */
  getCurrentTime: () => number;
  /**
   * "Na stránce se právě rozjelo video, hudba drž."
   *
   * Bez tohohle stačilo přepnout na Video a hrálo obojí naráz, každé v jiném
   * čase. Zastavit hudbu při přepnutí nestačí - je to jednorázový povel a
   * kdykoliv se cokoliv rozhodne skladbu zase rozjet, jsme tam, kde jsme byli.
   * Tohle je stav, ne povel: dokud je zapnutý, hudba hrát nesmí, a lišta dole
   * se schová, aby ji nešlo pustit ani ručně.
   */
  setVideoTakeover: (active: boolean) => void;
  /**
   * Přihlášení přehrávače videa ze stránky.
   *
   * Lišta dole je dálkový ovladač toho, co zrovna hraje - ne jen hudby.
   * Když si divák u skladby přepne na video, ovládá lišta rovnou ten
   * přehrávač a ukazuje jeho čas. Bez tohohle by ukazovala hudbu, která
   * mezitím stojí, a čísla v ní by neseděla s obrazem.
   */
  registerPageVideo: (entry: { player: any; trackId: string } | null) => void;
  /** Ztlumení. Druhé kliknutí vrátí hlasitost tam, kde byla před ztlumením. */
  toggleMute: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (value: number) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  /** Stránka videa hlásí "velký obal téhle skladby ukazuju já" - lišta dole se pak schová. */
  attachStage: (videoId: string | null) => void;
};

type MusicState = {
  track: MusicTrack | null;
  queue: MusicTrack[];
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  stageId: string | null;
  videoTakeover: boolean;
  /** Zvuk drží přehrávač videa na stránce, ne hudba. Lišta ho jen zrcadlí. */
  mirroringPageVideo: boolean;
};

const EMPTY_STATE: MusicState = {
  track: null,
  queue: [],
  playing: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  repeat: 'off',
  shuffle: false,
  stageId: null,
  videoTakeover: false,
  mirroringPageVideo: false,
};

const CommandsContext = createContext<MusicCommands | null>(null);
const StateContext = createContext<MusicState>(EMPTY_STATE);

export function useMusicCommands(): MusicCommands {
  const commands = useContext(CommandsContext);
  if (!commands) throw new Error('useMusicCommands musí být uvnitř MusicPlayerProvider');
  return commands;
}

export function useMusicState(): MusicState {
  return useContext(StateContext);
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredVolume(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Zakázaný localStorage nesmí shodit přehrávání.
  }
}

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const [track, setTrack] = useState<MusicTrack | null>(null);
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [videoTakeover, setVideoTakeoverState] = useState(false);
  const [pageVideo, setPageVideo] = useState<{ player: any; trackId: string } | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);

  // Zrcadla stavu pro příkazy. Bez nich by se příkazy musely přepisovat
  // pokaždé, když doběhne vteřina, a s nimi by se překreslovalo všechno,
  // co si je vzalo.
  const trackRef = useRef<MusicTrack | null>(null);
  const queueRef = useRef<MusicTrack[]>([]);
  const repeatRef = useRef<RepeatMode>('off');
  const shuffleRef = useRef(false);
  const volumeRef = useRef(1);
  const currentTimeRef = useRef(0);
  const takeoverRef = useRef(false);
  // Přehrávač videa ze stránky, když zvuk drží on. Vedle stavu i v ref,
  // protože příkazy se schválně nepřepisují a stav by v nich zestárnul.
  const pageVideoRef = useRef<{ player: any; trackId: string } | null>(null);
  // Hlasitost před ztlumením, ať se dá vrátit přesně tam, kde byla.
  const volumeBeforeMuteRef = useRef(0.7);

  trackRef.current = track;
  queueRef.current = queue;
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  volumeRef.current = volume;
  currentTimeRef.current = currentTime;
  takeoverRef.current = videoTakeover;
  pageVideoRef.current = pageVideo;

  // Lišta zrcadlí video jen tehdy, když jde o tu samou skladbu.
  const mirroringPageVideo = !!pageVideo && pageVideo.trackId === track?.id;

  useEffect(() => {
    setRepeat(readStored(REPEAT_KEY, ['off', 'one', 'all'] as const, 'off'));
    setShuffle(readStored(SHUFFLE_KEY, ['true', 'false'] as const, 'false') === 'true');
    const savedVolume = readStoredVolume();
    if (savedVolume !== null) setVolumeState(savedVolume);
  }, []);

  // Druhá pojistka. Kdyby se skladba napojila až po přepnutí na video
  // (napojení je smyčka, ne okamžik), povel z přepínače by se ztratil.
  useEffect(() => {
    if (videoTakeover) playerRef.current?.pause?.();
  }, [videoTakeover, track?.id]);

  /**
   * Přehrávač videa, který má zrovna zvuk pro sebe.
   *
   * Vrací ho jen tehdy, když jde o tu samou skladbu, kterou lišta ukazuje.
   * U obyčejného videa (jiná skladba, jiný obsah) lišta dál patří hudbě,
   * jen ta hudba stojí - aby si ji divák mohl kdykoliv pustit zpátky.
   */
  const mirroredPlayer = useCallback(() => {
    const entry = pageVideoRef.current;
    if (!entry || entry.trackId !== trackRef.current?.id) return null;
    return entry.player ?? null;
  }, []);

  /**
   * Čísla v liště berou ze správného přehrávače.
   *
   * Dokud běží video té samé skladby, čte lišta čas z něj. Předtím ukazovala
   * čas hudby, která mezitím stála - v liště tedy svítilo něco úplně jiného,
   * než co bylo slyšet.
   */
  useEffect(() => {
    if (!mirroringPageVideo || !pageVideo?.player) return;

    const player = pageVideo.player;
    let lastTick = 0;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => setDuration(player.duration ?? 0);
    const onTime = () => {
      const now = Date.now();
      if (now - lastTick < 250) return;
      lastTick = now;
      setCurrentTime(player.currentTime ?? 0);
    };

    player.addEventListener?.('play', onPlay);
    player.addEventListener?.('pause', onPause);
    player.addEventListener?.('loadedmetadata', onMeta);
    player.addEventListener?.('timeupdate', onTime);

    // Hudba při zrcadlení nikdy nehraje - zvuk má video.
    playerRef.current?.pause?.();
    setPlaying(!player.paused);
    if (player.duration) setDuration(player.duration);

    return () => {
      player.removeEventListener?.('play', onPlay);
      player.removeEventListener?.('pause', onPause);
      player.removeEventListener?.('loadedmetadata', onMeta);
      player.removeEventListener?.('timeupdate', onTime);
    };
  }, [mirroringPageVideo, pageVideo]);

  /**
   * Vrátí zvuk hudbě.
   *
   * Přeskočení na jinou skladbu při běžícím videu je jasný pokyn "chci
   * poslouchat" - video se proto zastaví a další skladba se rozjede v
   * hudebním přehrávači. Video na stránce zůstane stát tam, kde bylo.
   */
  const releaseVideo = useCallback(() => {
    pageVideoRef.current?.player?.pause?.();
    takeoverRef.current = false;
    setVideoTakeoverState(false);
  }, []);

  const pickNextIndex = useCallback((): number | null => {
    const list = queueRef.current;
    const current = trackRef.current;
    if (list.length === 0 || !current) return null;

    const index = list.findIndex((item) => item.id === current.id);

    if (shuffleRef.current) {
      if (list.length === 1) return repeatRef.current === 'all' ? 0 : null;
      // Náhodně, ale nikdy to samé znovu hned po sobě.
      let candidate = index;
      while (candidate === index) candidate = Math.floor(Math.random() * list.length);
      return candidate;
    }

    if (index === -1) return 0;
    if (index + 1 < list.length) return index + 1;
    return repeatRef.current === 'all' ? 0 : null;
  }, []);

  const handleEnded = useCallback(() => {
    const player = playerRef.current;

    if (repeatRef.current === 'one' && player) {
      player.currentTime = 0;
      player.play?.();
      return;
    }

    const nextIndex = pickNextIndex();
    if (nextIndex === null) {
      setPlaying(false);
      return;
    }

    setCurrentTime(0);
    setDuration(0);
    setTrack(queueRef.current[nextIndex]);
  }, [pickNextIndex]);

  /**
   * Napojení na přehrávač Cloudflare.
   *
   * SDK se načítá "až bude čas" (viz app/layout.tsx), takže se na něj chvíli
   * čeká v krátké smyčce - stejně jako u náhledů na kartách.
   */
  useEffect(() => {
    if (!track) {
      playerRef.current = null;
      return;
    }

    playerRef.current = null;
    let cancelled = false;
    let lastTick = 0;

    const interval = setInterval(() => {
      if (cancelled || playerRef.current) return;
      if (!iframeRef.current || !(window as any).Stream) return;

      const player = (window as any).Stream(iframeRef.current);
      playerRef.current = player;
      player.volume = volumeRef.current;
      player.muted = false;

      player.addEventListener('play', () => setPlaying(true));
      player.addEventListener('pause', () => setPlaying(false));
      player.addEventListener('loadedmetadata', () => setDuration(player.duration ?? 0));
      player.addEventListener('timeupdate', () => {
        // Čtyřikrát za vteřinu stačí. Cloudflare hlásí čas mnohem častěji
        // a každé hlášení by jinak překreslilo lištu i obal.
        const now = Date.now();
        if (now - lastTick < 250) return;
        lastTick = now;
        setCurrentTime(player.currentTime ?? 0);
      });
      player.addEventListener('ended', handleEnded);

      // Skladba se rozjede jen tehdy, když zvuk nedrží video na stránce.
      if (!takeoverRef.current) player.play?.();
      clearInterval(interval);
    }, 60);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  // Příkazy se vytvoří jednou a už se nemění - všechno potřebné čtou z ref.
  const commands = useMemo<MusicCommands>(
    () => ({
      openTrack(nextTrack, nextQueue) {
        if (nextQueue) setQueue(nextQueue);
        if (trackRef.current?.id === nextTrack.id) return;
        setCurrentTime(0);
        setDuration(nextTrack.duration ?? 0);
        setTrack(nextTrack);
      },
      toggle() {
        // Zrcadlí-li lišta video ze stránky, ovládá se video. Jinak hudba -
        // a když hudba stojí kvůli běžícímu videu, pustit ji znamená vzít
        // zvuk videu, ne hrát přes něj.
        const mirrored = mirroredPlayer();
        if (mirrored) {
          if (mirrored.paused) mirrored.play?.();
          else mirrored.pause?.();
          return;
        }

        const player = playerRef.current;
        if (!player) return;

        if (player.paused) {
          pageVideoRef.current?.player?.pause?.();
          takeoverRef.current = false;
          setVideoTakeoverState(false);
          player.play?.();
        } else {
          player.pause?.();
        }
      },
      pause() {
        playerRef.current?.pause?.();
      },
      resume() {
        if (takeoverRef.current) return;
        playerRef.current?.play?.();
      },
      getCurrentTime() {
        return currentTimeRef.current;
      },
      setVideoTakeover(active) {
        takeoverRef.current = active;
        setVideoTakeoverState(active);
        if (active) playerRef.current?.pause?.();
      },
      stop() {
        playerRef.current?.pause?.();
        playerRef.current = null;
        setTrack(null);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
      },
      next() {
        const nextIndex = pickNextIndex();
        if (nextIndex === null) return;
        releaseVideo();
        setCurrentTime(0);
        setDuration(0);
        setTrack(queueRef.current[nextIndex]);
      },
      previous() {
        // Do tří vteřin skladby se skáče na začátek, teprve pak na
        // předchozí - tohle chování má každý přehrávač a lidi ho čekají.
        if (currentTimeRef.current > 3) {
          const target = mirroredPlayer() ?? playerRef.current;
          if (target) target.currentTime = 0;
          setCurrentTime(0);
          return;
        }

        releaseVideo();

        const list = queueRef.current;
        const current = trackRef.current;
        if (!current || list.length === 0) return;

        const index = list.findIndex((item) => item.id === current.id);
        const target = index > 0 ? index - 1 : repeatRef.current === 'all' ? list.length - 1 : -1;
        if (target < 0) {
          if (playerRef.current) playerRef.current.currentTime = 0;
          setCurrentTime(0);
          return;
        }

        setCurrentTime(0);
        setDuration(0);
        setTrack(list[target]);
      },
      seek(seconds) {
        const target = mirroredPlayer() ?? playerRef.current;
        if (!target) return;
        target.currentTime = seconds;
        setCurrentTime(seconds);
      },
      setVolume(value) {
        const clamped = Math.max(0, Math.min(1, value));
        setVolumeState(clamped);
        if (clamped > 0) volumeBeforeMuteRef.current = clamped;
        // Hlasitost platí pro obojí - divák nerozlišuje, který přehrávač
        // zrovna hraje, a nechce si ji přenastavovat při každém přepnutí.
        if (playerRef.current) playerRef.current.volume = clamped;
        const page = pageVideoRef.current?.player;
        if (page) page.volume = clamped;
        store(VOLUME_KEY, String(clamped));
      },
      toggleMute() {
        const current = volumeRef.current;
        const next = current > 0 ? 0 : volumeBeforeMuteRef.current || 0.7;
        if (current > 0) volumeBeforeMuteRef.current = current;

        setVolumeState(next);
        if (playerRef.current) playerRef.current.volume = next;
        const page = pageVideoRef.current?.player;
        if (page) page.volume = next;
        store(VOLUME_KEY, String(next));
      },
      registerPageVideo(entry) {
        pageVideoRef.current = entry;
        setPageVideo(entry);
        if (entry?.player) entry.player.volume = volumeRef.current;
      },
      cycleRepeat() {
        setRepeat((prev) => {
          const order: RepeatMode[] = ['off', 'all', 'one'];
          const value = order[(order.indexOf(prev) + 1) % order.length];
          store(REPEAT_KEY, value);
          return value;
        });
      },
      toggleShuffle() {
        setShuffle((prev) => {
          store(SHUFFLE_KEY, String(!prev));
          return !prev;
        });
      },
      attachStage(videoId) {
        setStageId(videoId);
      },
    }),
    [pickNextIndex, mirroredPlayer, releaseVideo]
  );

  const state = useMemo<MusicState>(
    () => ({ track, queue, playing, currentTime, duration, volume, repeat, shuffle, stageId, videoTakeover, mirroringPageVideo }),
    [track, queue, playing, currentTime, duration, volume, repeat, shuffle, stageId, videoTakeover, mirroringPageVideo]
  );

  return (
    <CommandsContext.Provider value={commands}>
      <StateContext.Provider value={state}>
        {children}
        {track && (
          <iframe
            // Nová skladba = nový iframe. Přehodit adresu za běhu jde,
            // ale napojení SDK by pak ukazovalo na starý přehrávač.
            key={track.id}
            ref={iframeRef}
            className="music-engine-frame"
            src={`https://iframe.videodelivery.net/${track.cloudflareId}?controls=false&autoplay=true`}
            allow="autoplay; encrypted-media"
            title={track.title}
          />
        )}
      </StateContext.Provider>
    </CommandsContext.Provider>
  );
}
