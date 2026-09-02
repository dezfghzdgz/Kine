'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { chooseNext, choosePrevious, planPreload, planSwap, type Slot, type SlotIndex, type Slots } from './musicSlots';

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
 * ---------------------------------------------------------------------
 * DVĚ VĚCI, KTERÉ SE TU ZMĚNILY, A PROČ
 * ---------------------------------------------------------------------
 *
 * 1. JEDEN PŘEHRÁVAČ, NE DVA
 *
 * Dřív měla stránka videa v hudebním režimu vlastní iframe se stejným
 * videem, jaké hrálo tady. Dva přehrávače téhož videa na jedné stránce si
 * ale lezou do zelí: appka se na ten druhý napojila, poslala mu "hraj" -
 * a nic. Odtud to "přepnu na video a video se nikdy nenačte", i když se
 * po chvíli objevilo tlačítko Přehrát (tedy appka přehrávač našla a
 * povely posílala, jen nedošly).
 *
 * Odteď je přehrávač jeden, tenhle. Když si divák u skladby přepne na
 * Video, iframe se prostě přesune přes místo, kde má být obraz
 * (showEngineOver). Nic se nenačítá znovu, zvuk nepřeskočí a přepnutí je
 * okamžité.
 *
 * 2. DVA SLOTY, ABY MEZI SKLADBAMI NEBYLA DÍRA
 *
 * Každá další skladba znamenala nový iframe od nuly: stáhnout skript
 * Cloudflare, manifest, první kus zvuku. Mezi skladbami proto bylo několik
 * vteřin ticha. Teď jsou sloty dva - zatímco jeden hraje, druhý si tiše
 * dopředu načte skladbu, která přijde na řadu. Přepnutí je pak jen výměna
 * slotů.
 *
 * ---------------------------------------------------------------------
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

/** Kam se má obraz přehrávače promítnout, v souřadnicích okna. */
export type EngineRect = { top: number; left: number; width: number; height: number };

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
   * Platí pro OBYČEJNÁ videa, ne pro hudbu. U hudby je totiž tenhle
   * přehrávač zároveň tím, co je vidět - kdyby se sám pozastavil, přepnutí
   * na Video by ho umlčelo.
   */
  setVideoTakeover: (active: boolean) => void;
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
  /**
   * "Promítni obraz sem."
   *
   * Stránka videa předá obdélník, kde má být vidět přehrávač; iframe se
   * tam přesune. null ho zase schová. Tímhle se z přepnutí obal/video
   * stala čistě vizuální věc - žádné druhé načítání.
   */
  showEngineOver: (rect: EngineRect | null) => void;
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
  /** Obraz přehrávače je zrovna vidět na stránce (režim Video u hudby). */
  engineVisible: boolean;
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
  engineVisible: false,
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
  const [slots, setSlots] = useState<Slots>([
    { key: 'a0', track: null },
    { key: 'b0', track: null },
  ]);
  const [active, setActive] = useState<SlotIndex>(0);

  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [stageId, setStageId] = useState<string | null>(null);
  const [videoTakeover, setVideoTakeoverState] = useState(false);
  const [engineRect, setEngineRect] = useState<EngineRect | null>(null);

  const track = slots[active].track;

  const frameRefs = useRef<(HTMLIFrameElement | null)[]>([null, null]);
  const playersRef = useRef<any[]>([null, null]);
  const boundKeysRef = useRef<(string | null)[]>([null, null]);

  // Zrcadla stavu pro příkazy. Bez nich by se příkazy musely přepisovat
  // pokaždé, když doběhne vteřina, a s nimi by se překreslovalo všechno,
  // co si je vzalo.
  const slotsRef = useRef(slots);
  const activeRef = useRef<SlotIndex>(0);
  const queueRef = useRef<MusicTrack[]>([]);
  const repeatRef = useRef<RepeatMode>('off');
  const shuffleRef = useRef(false);
  const volumeRef = useRef(1);
  const currentTimeRef = useRef(0);
  const takeoverRef = useRef(false);
  // Hlasitost před ztlumením, ať se dá vrátit přesně tam, kde byla.
  const volumeBeforeMuteRef = useRef(0.7);
  // Kterou skladbu jsme si vybrali jako další. Drží se, aby náhodné
  // pořadí nevybralo při každém dotazu něco jiného - jinak by se předem
  // načetlo jedno a pustilo druhé.
  const nextChoiceRef = useRef<MusicTrack | null>(null);
  const slotSeqRef = useRef(0);

  slotsRef.current = slots;
  activeRef.current = active;
  queueRef.current = queue;
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;
  volumeRef.current = volume;
  currentTimeRef.current = currentTime;
  takeoverRef.current = videoTakeover;

  const activePlayer = useCallback(() => playersRef.current[activeRef.current], []);

  useEffect(() => {
    setRepeat(readStored(REPEAT_KEY, ['off', 'one', 'all'] as const, 'off'));
    setShuffle(readStored(SHUFFLE_KEY, ['true', 'false'] as const, 'false') === 'true');
    const savedVolume = readStoredVolume();
    if (savedVolume !== null) setVolumeState(savedVolume);
  }, []);

  // Druhá pojistka. Kdyby se skladba napojila až po přepnutí na obyčejné
  // video (napojení je smyčka, ne okamžik), povel by se ztratil.
  useEffect(() => {
    if (videoTakeover) playersRef.current.forEach((p) => p?.pause?.());
  }, [videoTakeover, track?.id]);

  /** Která skladba přijde na řadu. Vybere se jednou a drží se. */
  const pickNext = useCallback((): MusicTrack | null => {
    return chooseNext(queueRef.current, slotsRef.current[activeRef.current].track?.id ?? null, {
      shuffle: shuffleRef.current,
      repeat: repeatRef.current,
    });
  }, []);

  /**
   * Přesune přehrávání do druhého slotu.
   *
   * Když už je v něm ta správná skladba (protože se předem načetla),
   * je to jen výměna - žádné čekání.
   */
  const goToTrack = useCallback((next: MusicTrack) => {
    const from = activeRef.current;
    const to: 0 | 1 = from === 0 ? 1 : 0;

    setCurrentTime(0);
    setDuration(next.duration ?? 0);
    nextChoiceRef.current = null;

    slotSeqRef.current += 1;
    const plan = planSwap(slotsRef.current, from, next, `s${slotSeqRef.current}`);

    if (!plan.reused) {
      playersRef.current[to] = null;
      boundKeysRef.current[to] = null;
      setSlots(plan.slots);
    }

    playersRef.current[from]?.pause?.();
    setActive(plan.active);
  }, []);

  const handleEnded = useCallback(() => {
    if (repeatRef.current === 'one') {
      const player = playersRef.current[activeRef.current];
      if (player) {
        player.currentTime = 0;
        player.play?.();
      }
      return;
    }

    const next = nextChoiceRef.current ?? pickNext();
    if (!next) {
      setPlaying(false);
      return;
    }
    goToTrack(next);
  }, [pickNext, goToTrack]);

  /**
   * Napojení na přehrávače Cloudflare.
   *
   * SDK se načítá "až bude čas" (viz app/layout.tsx), takže se na něj chvíli
   * čeká v krátké smyčce - stejně jako u náhledů na kartách. Smyčka má
   * strop: kdyby se skript nenačetl vůbec, běžela by jinak donekonečna.
   */
  useEffect(() => {
    let cancelled = false;
    let pokusy = 0;
    const lastTick = [0, 0];

    const interval = setInterval(() => {
      if (cancelled) return;

      pokusy++;
      if (pokusy > 300) {
        clearInterval(interval);
        return;
      }

      if (!(window as any).Stream) return;

      for (const i of [0, 1] as const) {
        const slot = slotsRef.current[i];
        const frame = frameRefs.current[i];
        if (!slot.track || !frame) continue;
        if (boundKeysRef.current[i] === slot.key) continue;

        const player = (window as any).Stream(frame);
        playersRef.current[i] = player;
        boundKeysRef.current[i] = slot.key;

        player.volume = volumeRef.current;
        // Slot, který si jen dopředu načítá další skladbu, musí být
        // potichu - jinak by hrály dvě věci přes sebe.
        player.muted = i !== activeRef.current;

        player.addEventListener('play', () => {
          if (activeRef.current === i) setPlaying(true);
        });
        player.addEventListener('pause', () => {
          if (activeRef.current === i) setPlaying(false);
        });
        player.addEventListener('loadedmetadata', () => {
          if (activeRef.current === i) setDuration(player.duration ?? 0);
        });
        player.addEventListener('timeupdate', () => {
          if (activeRef.current !== i) return;
          // Čtyřikrát za vteřinu stačí. Cloudflare hlásí čas mnohem častěji
          // a každé hlášení by jinak překreslilo lištu i obal.
          const now = Date.now();
          if (now - lastTick[i] < 250) return;
          lastTick[i] = now;
          setCurrentTime(player.currentTime ?? 0);
        });
        player.addEventListener('ended', () => {
          if (activeRef.current === i) handleEnded();
        });

        // Skladba se rozjede jen tehdy, když zvuk nedrží obyčejné video.
        if (i === activeRef.current && !takeoverRef.current) player.play?.();
      }
    }, 60);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slots, handleEnded]);

  /**
   * Rozjezd po výměně slotů.
   *
   * Slot, na který se právě přepnulo, dostane zvuk a pustí se od začátku.
   * Ten druhý mlčí a čeká, až do něj přijde další skladba.
   */
  useEffect(() => {
    const player = playersRef.current[active];
    const other = playersRef.current[active === 0 ? 1 : 0];

    other?.pause?.();
    if (other) other.muted = true;

    if (player) {
      player.muted = false;
      player.volume = volumeRef.current;
      // Předem načtený slot mohl kus přehrát ještě potichu; skladba má
      // začít od začátku.
      if ((player.currentTime ?? 0) > 0.5) player.currentTime = 0;
      if (!takeoverRef.current) player.play?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slots[active].key]);

  /**
   * Dopředné načtení další skladby.
   *
   * Bez tohohle je mezi skladbami několik vteřin ticha, protože nový
   * iframe začíná od nuly. Načítá se do slotu, který zrovna nehraje.
   */
  useEffect(() => {
    if (!track) return;

    const choice = pickNext();
    nextChoiceRef.current = choice;

    slotSeqRef.current += 1;
    const plan = planPreload(slots, active, choice, `s${slotSeqRef.current}`);
    if (!plan) return;

    playersRef.current[plan.idle] = null;
    boundKeysRef.current[plan.idle] = null;
    setSlots(plan.slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, queue, repeat, shuffle, active]);

  // Příkazy se vytvoří jednou a už se nemění - všechno potřebné čtou z ref.
  const commands = useMemo<MusicCommands>(
    () => ({
      openTrack(nextTrack, nextQueue) {
        if (nextQueue) setQueue(nextQueue);
        if (slotsRef.current[activeRef.current].track?.id === nextTrack.id) return;
        goToTrack(nextTrack);
      },
      toggle() {
        const player = activePlayer();
        if (!player) return;

        if (player.paused) {
          // Pustit hudbu znamená vzít zvuk videu, ne hrát přes něj.
          takeoverRef.current = false;
          setVideoTakeoverState(false);
          player.play?.();
        } else {
          player.pause?.();
        }
      },
      pause() {
        activePlayer()?.pause?.();
      },
      resume() {
        if (takeoverRef.current) return;
        activePlayer()?.play?.();
      },
      getCurrentTime() {
        return currentTimeRef.current;
      },
      setVideoTakeover(activeNow) {
        takeoverRef.current = activeNow;
        setVideoTakeoverState(activeNow);
        if (activeNow) playersRef.current.forEach((p) => p?.pause?.());
      },
      stop() {
        playersRef.current.forEach((p) => p?.pause?.());
        playersRef.current = [null, null];
        boundKeysRef.current = [null, null];
        setSlots([
          { key: 'a-off', track: null },
          { key: 'b-off', track: null },
        ] as Slots);
        setPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setEngineRect(null);
      },
      next() {
        const choice = nextChoiceRef.current ?? pickNext();
        if (!choice) return;
        goToTrack(choice);
      },
      previous() {
        // Do tří vteřin skladby se skáče na začátek, teprve pak na
        // předchozí - tohle chování má každý přehrávač a lidi ho čekají.
        const player = activePlayer();
        if (currentTimeRef.current > 3) {
          if (player) player.currentTime = 0;
          setCurrentTime(0);
          return;
        }

        const target = choosePrevious(
          queueRef.current,
          slotsRef.current[activeRef.current].track?.id ?? null,
          repeatRef.current
        );
        if (!target) {
          if (player) player.currentTime = 0;
          setCurrentTime(0);
          return;
        }

        goToTrack(target);
      },
      seek(seconds) {
        const player = activePlayer();
        if (!player) return;
        player.currentTime = seconds;
        setCurrentTime(seconds);
      },
      setVolume(value) {
        const clamped = Math.max(0, Math.min(1, value));
        setVolumeState(clamped);
        if (clamped > 0) volumeBeforeMuteRef.current = clamped;
        const player = activePlayer();
        if (player) player.volume = clamped;
        store(VOLUME_KEY, String(clamped));
      },
      toggleMute() {
        const current = volumeRef.current;
        const next = current > 0 ? 0 : volumeBeforeMuteRef.current || 0.7;
        if (current > 0) volumeBeforeMuteRef.current = current;

        setVolumeState(next);
        const player = activePlayer();
        if (player) player.volume = next;
        store(VOLUME_KEY, String(next));
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
      showEngineOver(rect) {
        setEngineRect(rect);
      },
    }),
    [activePlayer, pickNext, goToTrack]
  );

  const state = useMemo<MusicState>(
    () => ({
      track,
      queue,
      playing,
      currentTime,
      duration,
      volume,
      repeat,
      shuffle,
      stageId,
      videoTakeover,
      engineVisible: engineRect !== null,
    }),
    [track, queue, playing, currentTime, duration, volume, repeat, shuffle, stageId, videoTakeover, engineRect]
  );

  return (
    <CommandsContext.Provider value={commands}>
      <StateContext.Provider value={state}>
        {children}
        {slots.map((slot, i) =>
          slot.track ? (
            <iframe
              // Nová skladba = nový iframe. Přehodit adresu za běhu jde,
              // ale napojení SDK by pak ukazovalo na starý přehrávač.
              key={slot.key}
              ref={(el) => {
                frameRefs.current[i] = el;
              }}
              className={
                i === active && engineRect ? 'music-engine-frame music-engine-frame-onscreen' : 'music-engine-frame'
              }
              style={
                i === active && engineRect
                  ? {
                      top: engineRect.top,
                      left: engineRect.left,
                      width: engineRect.width,
                      height: engineRect.height,
                    }
                  : undefined
              }
              // Slot, který se jen předem načítá, se nesmí rozjet sám.
              src={`https://iframe.videodelivery.net/${slot.track.cloudflareId}?controls=false${
                i === active ? '&autoplay=true' : '&muted=true'
              }`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen;"
              title={slot.track.title}
            />
          ) : null
        )}
      </StateContext.Provider>
    </CommandsContext.Provider>
  );
}
