'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { chooseNext, choosePrevious, planPreload, planSwap, type Slot, type SlotIndex, type Slots } from './musicSlots';
import { attachHls, preloadHls, supportsNativeHls, type Detach } from './hlsAttach';
import { chooseEngineKind, companionCorrection, customerCodeFromUrl, manifestUrl, type EngineKind } from './streamSource';

/**
 * Hudba, která hraje dál i po odchodu ze stránky.
 *
 * Tohle je ta věc, kvůli které lidi chodí na YouTube Music: pustíš skladbu,
 * odejdeš prohlížet a hudba jede. Bez ní je "hudební režim" jenom jiný
 * vzhled.
 *
 * Proč to musí být tady a ne na stránce videa: jakmile Next.js při
 * přechodu na jinou stránku přehrávač odpojí, zvuk utne - a při každé
 * navigaci ho odpojí. Přehrávač proto žije jednou provždy tady, v kostře
 * appky, a stránky ho jen ovládají.
 *
 * ---------------------------------------------------------------------
 * VLASTNÍ PŘEHRÁVAČ MÍSTO IFRAMU CLOUDFLARE
 * ---------------------------------------------------------------------
 *
 * Hudba dřív hrála v iframu Cloudflare (jejich přehrávač, ovládaný přes
 * SDK). Na telefonu to mělo dvě vady, které se nedaly obejít: zamčená
 * obrazovka ukazovala "Stream" a prázdný čtverec (název a obal si telefon
 * bere od dokumentu, kterému zvuk patří - a to byl cizí iframe), a iPhone
 * po zamknutí video v iframu zastavil.
 *
 * Teď hraje hudba v našem vlastním <audio>/<video> z HLS manifestu, který
 * Cloudflare ke každému videu má (lib/streamSource.ts, lib/hlsAttach.ts):
 * Safari ho umí nativně, ostatní přes hls.js. Zvuk tak patří Kine -
 * zamčená obrazovka ukáže název, tvůrce i obal a ovládání z ní funguje
 * (Media Session níž), a v Safari hraje <audio> dál i při zamčeném
 * telefonu, jako každá hudební appka.
 *
 * JEDEN PŘEHRÁVAČ, NE DVA
 *
 * Stránka videa si v hudebním režimu vlastní přehrávač nezakládá. Když si
 * divák u skladby přepne na Video, obraz se promítne přes místo, kde má
 * být (showEngineOver): mimo Safari se tam přesune samo <video>
 * přehrávače; v Safari, kde hraje <audio>, se tam pustí tichý <video>
 * společník srovnaný podle zvuku. Zvuk ani v jednom případě nepřeskočí.
 *
 * DVA SLOTY, ABY MEZI SKLADBAMI NEBYLA DÍRA
 *
 * Zatímco jeden slot hraje, druhý si tiše dopředu načte skladbu, která
 * přijde na řadu. Přepnutí je pak jen výměna slotů, bez ticha.
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
   * Stránka videa předá obdélník, kde má být vidět přehrávač; obraz se
   * tam promítne. null ho zase schová. Tímhle se z přepnutí obal/video
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
    const raw = localStorage.getItem(VOLUME_KEY);
    // Chybějící hodnota je null a Number(null) je 0 - dřív tak každý, kdo
    // si hlasitost nikdy nenastavil, začínal s hudbou na nule (a potichu).
    if (raw === null || raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

/** play() vrací slib; bez svolení prohlížeče (žádné kliknutí) padá - to není chyba appky. */
function safePlay(el: HTMLMediaElement | null | undefined) {
  if (!el) return;
  const result = el.play();
  if (result && typeof result.catch === 'function') result.catch(() => {});
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

  // Přehrávače = samotné <audio>/<video> prvky slotů. Mají stejné API,
  // jaké mělo SDK Cloudflare (play, pause, currentTime, volume, muted...),
  // takže příkazy níž zůstaly, jak byly.
  const playersRef = useRef<(HTMLMediaElement | null)[]>([null, null]);
  const detachRefs = useRef<(Detach | null)[]>([null, null]);
  const boundKeysRef = useRef<(string | null)[]>([null, null]);
  // Rozhodne se jednou: Safari -> audio (+ tichý obraz), jinak video + hls.js.
  const [kind, setKind] = useState<EngineKind>('video');
  const kindRef = useRef<EngineKind>('video');
  // Zákaznická doména Cloudflare - appka ji pozná z adresy náhledu skladby.
  const customerCodeRef = useRef<string | null>(process.env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE || null);
  // Tichý obraz k <audio> v Safari (režim Video u hudby).
  const companionRef = useRef<HTMLVideoElement | null>(null);
  const companionDetachRef = useRef<Detach | null>(null);

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

  const activePlayer = useCallback((): HTMLMediaElement | null => playersRef.current[activeRef.current], []);

  useEffect(() => {
    setRepeat(readStored(REPEAT_KEY, ['off', 'one', 'all'] as const, 'off'));
    setShuffle(readStored(SHUFFLE_KEY, ['true', 'false'] as const, 'false') === 'true');
    const savedVolume = readStoredVolume();
    if (savedVolume !== null) setVolumeState(savedVolume);

    const chosen = chooseEngineKind(supportsNativeHls());
    kindRef.current = chosen;
    setKind(chosen);
    // Mimo Safari se hls.js stáhne hned, ať je při prvním kliknutí na
    // skladbu v ruce - napojení pak stihne to samé kliknutí, které
    // prohlížeč bere jako svolení pustit zvuk.
    preloadHls();
  }, []);

  // Druhá pojistka. Kdyby se skladba napojila až po přepnutí na obyčejné
  // video (napojení je smyčka, ne okamžik), povel by se ztratil.
  useEffect(() => {
    if (videoTakeover) playersRef.current.forEach((p) => p?.pause());
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

    // Nový slot = nový prvek; starý React odpojí sám (bindSlot s null).
    if (!plan.reused) setSlots(plan.slots);

    playersRef.current[from]?.pause();
    setActive(plan.active);
  }, []);

  const handleEnded = useCallback(() => {
    if (repeatRef.current === 'one') {
      const player = playersRef.current[activeRef.current];
      if (player) {
        player.currentTime = 0;
        safePlay(player);
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
   * Napojení slotu na jeho <audio>/<video>.
   *
   * Volá React, jakmile prvek slotu vznikne (a s null, když zmizí). Žádné
   * čekání na cizí SDK: prvek je náš, události má hned. Zdroj (HLS
   * manifest) dodá lib/hlsAttach.ts - v Safari nativně, jinak přes hls.js.
   */
  const bindSlot = useCallback(
    (i: SlotIndex, el: HTMLMediaElement | null) => {
      const previous = playersRef.current[i];
      if (el === previous) return;

      if (previous) {
        detachRefs.current[i]?.();
        detachRefs.current[i] = null;
        boundKeysRef.current[i] = null;
      }
      playersRef.current[i] = el;
      if (!el) return;

      const slot = slotsRef.current[i];
      if (!slot.track) return;
      boundKeysRef.current[i] = slot.key;

      if (!customerCodeRef.current) customerCodeRef.current = customerCodeFromUrl(slot.track.thumbnail);

      el.volume = volumeRef.current;
      // Slot, který si jen dopředu načítá další skladbu, musí být potichu -
      // jinak by hrály dvě věci přes sebe. Aktivní slot mlčí jen tehdy,
      // když má uživatel hlasitost na nule.
      el.muted = i !== activeRef.current || volumeRef.current === 0;

      let lastTick = 0;
      el.addEventListener('play', () => {
        if (activeRef.current === i) setPlaying(true);
      });
      el.addEventListener('pause', () => {
        if (activeRef.current === i) setPlaying(false);
      });
      el.addEventListener('loadedmetadata', () => {
        if (activeRef.current === i && Number.isFinite(el.duration)) setDuration(el.duration);
      });
      el.addEventListener('durationchange', () => {
        if (activeRef.current === i && Number.isFinite(el.duration)) setDuration(el.duration);
      });
      el.addEventListener('timeupdate', () => {
        if (activeRef.current !== i) return;
        // Čtyřikrát za vteřinu stačí - každé hlášení překreslí lištu i obal.
        const now = Date.now();
        if (now - lastTick < 250) return;
        lastTick = now;
        setCurrentTime(el.currentTime || 0);
      });
      el.addEventListener('ended', () => {
        if (activeRef.current === i) handleEnded();
      });
      el.addEventListener('error', () => {
        // Pojistka pro Safari: kdyby <audio> manifest s obrazem odmítlo,
        // přehrávač se jednou přepne na <video> (React prvky vymění a
        // napojí znovu). Zvuk v <video> při zamčeném telefonu Safari
        // zastaví, ale lepší hrát než mlčet.
        if (kindRef.current === 'audio' && activeRef.current === i) {
          console.warn('Kine hudba: <audio> zdroj nejde přehrát, přepínám na <video>', el.error?.code);
          kindRef.current = 'video';
          setKind('video');
        }
      });

      const url = manifestUrl(slot.track.cloudflareId, customerCodeRef.current);
      detachRefs.current[i] = attachHls(el, url, {
        onReady: () => {
          // Skladba se rozjede jen tehdy, když zvuk nedrží obyčejné video.
          // play() až po napojení zdroje: dřív by ho výměna zdroje přerušila.
          if (i === activeRef.current && !takeoverRef.current && playersRef.current[i] === el) {
            el.play().catch(() => {
              // Prohlížeč bez svolení (žádné kliknutí) - divák to pustí ručně.
            });
          }
        },
        onFatal: (why) => {
          console.warn('Kine hudba: zdroj nejde přehrát', why, slot.track?.id);
          if (activeRef.current === i) setPlaying(false);
        },
      });
    },
    [handleEnded]
  );

  // Stálé odkazy pro React: kdyby se předávala nová funkce při každém
  // překreslení, React by prvek "odpojil a připojil" pokaždé - a s ním
  // by shořelo i napojení zdroje.
  const bindSlot0 = useCallback((el: HTMLMediaElement | null) => bindSlot(0, el), [bindSlot]);
  const bindSlot1 = useCallback((el: HTMLMediaElement | null) => bindSlot(1, el), [bindSlot]);

  /**
   * Tichý obraz k <audio> (Safari, režim Video u hudby).
   *
   * Zvuk hraje dál z <audio>; společník si stejný manifest pustí bez
   * zvuku a drží se podle něj: malý rozdíl dorovná rychlostí, velký
   * skokem (lib/streamSource.ts). Když zvuk stojí, stojí i on.
   */
  const bindCompanion = useCallback((el: HTMLVideoElement | null) => {
    if (el === companionRef.current) return;
    companionDetachRef.current?.();
    companionDetachRef.current = null;
    companionRef.current = el;
    if (!el) return;

    const current = slotsRef.current[activeRef.current].track;
    if (!current) return;
    el.muted = true;
    el.playsInline = true;
    companionDetachRef.current = attachHls(el, manifestUrl(current.cloudflareId, customerCodeRef.current));
  }, []);

  useEffect(() => {
    if (kind !== 'audio' || !engineRect) return;
    const interval = setInterval(() => {
      const companion = companionRef.current;
      const audio = playersRef.current[activeRef.current];
      if (!companion || !audio) return;

      if (audio.paused) {
        if (!companion.paused) companion.pause();
        return;
      }
      if (companion.paused) companion.play().catch(() => { /* bez obrazu, zvuk hraje dál */ });

      const fix = companionCorrection(audio.currentTime, companion.currentTime);
      if (fix.seekTo !== null) companion.currentTime = fix.seekTo;
      if (companion.playbackRate !== fix.rate) companion.playbackRate = fix.rate;
    }, 250);
    return () => clearInterval(interval);
  }, [kind, engineRect]);

  /**
   * Rozjezd po výměně slotů.
   *
   * Slot, na který se právě přepnulo, dostane zvuk a pustí se od začátku.
   * Ten druhý mlčí a čeká, až do něj přijde další skladba.
   */
  useEffect(() => {
    const player = playersRef.current[active];
    const other = playersRef.current[active === 0 ? 1 : 0];

    other?.pause();
    if (other) other.muted = true;

    if (player) {
      // Zvuk dostane jen, když ho uživatel nemá ztlumený (hlasitost 0).
      player.muted = volumeRef.current === 0;
      player.volume = volumeRef.current;
      // Předem načtený slot mohl kus přehrát ještě potichu; skladba má
      // začít od začátku.
      if ((player.currentTime ?? 0) > 0.5) player.currentTime = 0;
      if (!takeoverRef.current) safePlay(player);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slots[active].key]);

  /**
   * Dopředné načtení další skladby.
   *
   * Bez tohohle je mezi skladbami několik vteřin ticha, protože nový
   * prvek začíná od nuly. Načítá se do slotu, který zrovna nehraje.
   */
  useEffect(() => {
    if (!track) return;

    const choice = pickNext();
    nextChoiceRef.current = choice;

    slotSeqRef.current += 1;
    const plan = planPreload(slots, active, choice, `s${slotSeqRef.current}`);
    if (!plan) return;

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
          safePlay(player);
        } else {
          player.pause();
        }
      },
      pause() {
        activePlayer()?.pause();
      },
      resume() {
        if (takeoverRef.current) return;
        safePlay(activePlayer());
      },
      getCurrentTime() {
        return currentTimeRef.current;
      },
      setVideoTakeover(activeNow) {
        takeoverRef.current = activeNow;
        setVideoTakeoverState(activeNow);
        if (activeNow) playersRef.current.forEach((p) => p?.pause());
      },
      stop() {
        playersRef.current.forEach((p) => p?.pause());
        // Prvky zmizí s prázdnými sloty a React zavolá bindSlot s null,
        // který zdroje odpojí. Odkazy se tu nenulují ručně - jinak by
        // úklid neměl co uklidit.
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
        if (player) {
          player.volume = clamped;
          // Nula = i muted. Samotná hlasitost 0 nechává některé přehrávače
          // tiše šumět a hlavně: dvě pojistky jsou lepší než jedna, když
          // jde o "ukazuje ztlumeno, a přitom hraje".
          player.muted = clamped === 0;
        }
        store(VOLUME_KEY, String(clamped));
      },
      toggleMute() {
        const current = volumeRef.current;
        const next = current > 0 ? 0 : volumeBeforeMuteRef.current || 0.7;
        if (current > 0) volumeBeforeMuteRef.current = current;

        setVolumeState(next);
        const player = activePlayer();
        if (player) {
          player.volume = next;
          player.muted = next === 0;
        }
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

  /* ---------- Media Session: zamčená obrazovka, oznámení, sluchátka ----------
     Telefon ukáže název skladby a ovládání na zamčené obrazovce a v
     oznámení, tlačítka na sluchátkách přepínají skladby. Přesně to, co má
     každá hudební appka a co člověk na mobilu postrádá první.

     Napsané defenzivně: kde prohlížeč Media Session nemá, nestane se nic.
     Funguje to právě proto, že zvuk hraje z NAŠEHO <audio>/<video> - u
     dřívějšího iframu Cloudflare si telefon bral název a obal od cizího
     dokumentu, a tak ukazoval "Stream" a prázdný čtverec. */

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? (navigator as any).mediaSession : null;
    if (!ms) return;
    try {
      if (!track) {
        ms.metadata = null;
        ms.playbackState = 'none';
        return;
      }
      const MediaMetadataCtor = (window as any).MediaMetadata;
      if (MediaMetadataCtor) {
        ms.metadata = new MediaMetadataCtor({
          title: track.title,
          artist: track.creator ?? 'Kine',
          album: 'Kine',
          // Bez "type": náhledy jsou jpg z Cloudflare i cokoliv z úložiště
          // (vlastní náhled tvůrce). Prohlížeč si typ zjistí sám.
          artwork: track.thumbnail
            ? [
                { src: track.thumbnail, sizes: '512x512' },
                { src: track.thumbnail, sizes: '256x256' },
              ]
            : [],
        });
      }
      ms.playbackState = playing ? 'playing' : 'paused';
    } catch {
      // Media Session je bonus - bez něj hudba hraje dál.
    }
  }, [track?.id, track?.title, track?.creator, track?.thumbnail, track, playing]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? (navigator as any).mediaSession : null;
    if (!ms || typeof ms.setActionHandler !== 'function') return;

    const handlers: [string, (details?: any) => void][] = [
      ['play', () => commands.resume()],
      ['pause', () => commands.pause()],
      ['previoustrack', () => commands.previous()],
      ['nexttrack', () => commands.next()],
      ['seekto', (d) => { if (typeof d?.seekTime === 'number') commands.seek(d.seekTime); }],
      ['seekbackward', (d) => commands.seek(Math.max(0, currentTimeRef.current - (d?.seekOffset ?? 10)))],
      ['seekforward', (d) => commands.seek(currentTimeRef.current + (d?.seekOffset ?? 10))],
    ];

    for (const [action, handler] of handlers) {
      try { ms.setActionHandler(action, handler); } catch { /* akci prohlížeč nezná */ }
    }
    return () => {
      for (const [action] of handlers) {
        try { ms.setActionHandler(action, null); } catch { /* viz výše */ }
      }
    };
  }, [commands]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? (navigator as any).mediaSession : null;
    if (!ms || typeof ms.setPositionState !== 'function') return;
    if (!track || !(duration > 0)) return;
    try {
      ms.setPositionState({ duration, playbackRate: 1, position: Math.min(Math.max(0, currentTime), duration) });
    } catch {
      // Neplatná pozice (např. delší než skladba) - prohlížeč ji odmítne, nic víc.
    }
  }, [track, duration, currentTime]);

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
        {slots.map((slot, i) => {
          if (!slot.track) return null;
          const onscreen = i === active && engineRect !== null && kind === 'video';
          const props = {
            // Nová skladba = nový prvek. Klíč slotu se mění s každou skladbou,
            // takže React nikdy nepřepisuje zdroj běžícímu prvku.
            key: slot.key,
            ref: i === 0 ? bindSlot0 : bindSlot1,
            className: onscreen ? 'music-engine-frame music-engine-frame-onscreen' : 'music-engine-frame',
            style: onscreen && engineRect
              ? { top: engineRect.top, left: engineRect.left, width: engineRect.width, height: engineRect.height }
              : undefined,
            preload: 'auto' as const,
            // Zvuk a start řídí napojení (bindSlot), ne atributy - ty jen
            // říkají, jak prvek vzniká: hrající, nebo tichý dopředu načtený.
            muted: slot.muted ?? false,
            title: slot.track.title,
          };
          return kind === 'audio' ? <audio {...props} /> : <video {...props} playsInline />;
        })}
        {/* Safari: <audio> hraje, obraz promítá tichý společník (viz bindCompanion). */}
        {kind === 'audio' && engineRect && track && (
          <video
            key={`companion-${track.id}`}
            ref={bindCompanion}
            className="music-engine-frame music-engine-frame-onscreen"
            style={{ top: engineRect.top, left: engineRect.left, width: engineRect.width, height: engineRect.height }}
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
          />
        )}
      </StateContext.Provider>
    </CommandsContext.Provider>
  );
}
