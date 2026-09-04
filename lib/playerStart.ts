/**
 * Rozjezd přehrávače Cloudflare.
 *
 * Přehrávač je cizí iframe a povel se do něj posílá zprávou. Když ještě
 * nestihl načíst svůj obsah, zpráva nemá kam dojít a tiše se ztratí -
 * přehrávač pak zůstane stát a nic se neděje.
 *
 * Předchozí verze to zkoušela dvacetkrát po 150 ms, tedy tři vteřiny, a
 * pak to vzdala. Tři vteřiny na rozjezd cizího iframu nestačí: musí si
 * stáhnout vlastní skript, manifest a první kus videa. Když se do nich
 * nevešel, nezavolal play() už nikdo a přehrávač zůstal stát navždy -
 * a protože jede bez vlastního ovládání (?controls=false), nešel spustit
 * ani ručně. Přesně to je stav "přepnu z obalu na video a video se nikdy
 * nenačte".
 *
 * Odteď platí tři věci najednou:
 *  - řídí se to událostmi přehrávače (ten sám řekne, kdy je připravený),
 *  - pokusy jsou jen záloha a řídnou, ale trvají skoro čtvrt minuty,
 *  - a když se to ani tak nerozjede, dá se o tom vědět ven (tlačítko).
 *
 * Je to vlastní soubor, a ne kus stránky videa, aby se to dalo otestovat
 * bez prohlížeče - viz test v tests/playerStart.test.mjs.
 */

/** Kdy se zkusí zavolat play(), v milisekundách od začátku. */
export const ATTEMPT_SCHEDULE = [0, 150, 400, 900, 1600, 2600, 4000, 6000, 9000, 13000];

/** Po jaké době bez přehrávání se nabídne tlačítko Přehrát. */
export const OFFER_TAP_AFTER_MS = 4000;

/**
 * O kolik vteřin se smí lišit čas přehrávače od cíle, než se převine.
 *
 * Bez téhle tolerance se přehrávač převíjel při každém pokusu dokola -
 * pokaždé zahodil, co stihl načíst, a nikdy se nerozjel.
 */
export const SEEK_TOLERANCE_S = 1.5;

export type StartOptions = {
  player: any;
  /** Kam se má skladba přesunout (předání času z obalu na video). */
  seekTo?: number | null;
  /** Je tenhle přehrávač pořád ten, o který jde? Jinak se všechno zruší. */
  isCurrent: () => boolean;
  /** Přehrávání se rozjelo. */
  onStarted?: () => void;
  /** Nerozjelo se to a je čas nabídnout tlačítko. */
  onNeedsTap?: () => void;
  /** Jen pro test - dovoluje podstrčit vlastní časovače. */
  timers?: {
    setTimeout: (fn: () => void, ms: number) => any;
    clearTimeout: (id: any) => void;
  };
};

/**
 * Spustí přehrávání. Vrací úklidovou funkci - zavolej ji, když se
 * přehrávač mění nebo stránka mizí.
 */
export function startPlayback(options: StartOptions): () => void {
  const { player, seekTo, isCurrent, onStarted, onNeedsTap } = options;
  const timers = options.timers ?? {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: any) => clearTimeout(id),
  };

  let started = false;
  let disposed = false;
  const handles: any[] = [];

  function cleanup() {
    if (disposed) return;
    disposed = true;
    handles.forEach(timers.clearTimeout);
    handles.length = 0;
    player?.removeEventListener?.('play', onPlay);
    player?.removeEventListener?.('loadedmetadata', attempt);
    player?.removeEventListener?.('canplay', attempt);
  }

  function onPlay() {
    if (started) return;
    started = true;
    onStarted?.();
    cleanup();
  }

  function attempt() {
    if (disposed || started) return;

    // Mezitím se mohl přehrávač vyměnit (jiné video, přepnutí na obal).
    if (!isCurrent()) {
      cleanup();
      return;
    }

    if (typeof seekTo === 'number' && seekTo > 0) {
      const now = player?.currentTime ?? 0;
      if (Math.abs(now - seekTo) > SEEK_TOLERANCE_S) {
        try {
          player.currentTime = seekTo;
        } catch {
          // Přehrávač ještě nepřijímá povely - zkusí se to za chvíli.
        }
      }
    }

    try {
      player?.play?.();
    } catch {
      // Totéž: ztracený povel není důvod skončit.
    }
  }

  player?.addEventListener?.('play', onPlay);
  player?.addEventListener?.('loadedmetadata', attempt);
  player?.addEventListener?.('canplay', attempt);

  for (const ms of ATTEMPT_SCHEDULE) {
    handles.push(timers.setTimeout(attempt, ms));
  }

  handles.push(
    timers.setTimeout(() => {
      // Pokusy na pozadí běží dál - když se to rozjede samo, tlačítko
      // zase zmizí.
      if (!started && !disposed && isCurrent()) onNeedsTap?.();
    }, OFFER_TAP_AFTER_MS)
  );

  return cleanup;
}
