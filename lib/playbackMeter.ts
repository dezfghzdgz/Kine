/**
 * Kolik divák opravdu viděl - z pozice přehrávače, kterou si stránka čte
 * zhruba jednou za vteřinu.
 *
 * Proč: historie (watch_history) se dřív zapsala hned při otevření
 * stránky. Dvouvteřinový překlik tak byl "zhlédnuté video" - hlavní
 * stránka ho pohřbila, po konci jiného videa se už nenabídlo a počítalo
 * se jako zájem. Teď se zapisuje až po ~3 s skutečného přehrávání
 * (REAL_PLAYBACK_S): přeskočení (seek) ani stojící video se nepočítají,
 * smyčka u Sparks ano.
 *
 * Čisté funkce bez prohlížeče (tests/feedRanking.test.mjs).
 */

export type PlaybackMeter = {
  /** Kolik vteřin opravdu hrálo. */
  played: number;
  /** Poslední přečtená pozice (s). */
  last: number | null;
  /** Nejdál, kam se přehrávání dostalo (s) - bez přeskakování. */
  maxPos: number;
  /** Kolikrát video doběhlo do konce a jelo znovu (Sparks hrají ve smyčce). */
  loops: number;
};

export const EMPTY_METER: PlaybackMeter = { played: 0, last: null, maxPos: 0, loops: 0 };

/** Od kolika vteřin skutečného přehrávání se video zapíše do historie. */
export const REAL_PLAYBACK_S = 3;

export type PlaybackSample = { time: number; playing: boolean; duration?: number | null };

/**
 * Jeden krok měřáku. `maxStep` = nejdelší skok mezi dvěma čteními, který
 * se ještě bere jako přehrávání (delší je přeskočení). Když přehrávač pozici
 * neřekne (NaN), ale hraje, počítá se `tickSeconds` za krok.
 */
export function meterStep(
  meter: PlaybackMeter,
  sample: PlaybackSample,
  opts: { maxStep?: number; tickSeconds?: number } = {}
): PlaybackMeter {
  const maxStep = opts.maxStep ?? 2.5;
  const time = Number(sample.time);
  if (!Number.isFinite(time) || time < 0) {
    return sample.playing ? { ...meter, played: meter.played + (opts.tickSeconds ?? 1) } : meter;
  }
  if (!sample.playing) return { ...meter, last: time };
  if (meter.last === null) return { ...meter, last: time, maxPos: Math.max(meter.maxPos, time) };
  const delta = time - meter.last;
  if (delta > 0 && delta <= maxStep) {
    return { played: meter.played + delta, last: time, maxPos: Math.max(meter.maxPos, time), loops: meter.loops };
  }
  const duration = Number(sample.duration);
  if (delta < 0 && Number.isFinite(duration) && duration > 0 && meter.last >= duration - Math.max(1.5, maxStep) && time <= maxStep) {
    // Smyčka: z konce znovu na začátek - to je přehrávání, ne přeskočení.
    const added = Math.max(0, duration - meter.last) + time;
    return { played: meter.played + Math.min(added, maxStep * 2), last: time, maxPos: duration, loops: meter.loops + 1 };
  }
  // Přeskočení (nebo dlouhá mezera, třeba uspaný telefon) - nepočítá se.
  return { ...meter, last: time };
}

/** Pozice pro historii (s) a jestli je dokoukáno. */
export function meterProgress(meter: PlaybackMeter, durationSeconds: number | null | undefined): { progress: number; completed: boolean } {
  const duration = Number(durationSeconds);
  const known = Number.isFinite(duration) && duration > 0;
  const progress = Math.max(0, Math.floor(known ? Math.min(duration, meter.maxPos) : meter.maxPos));
  const completed = meter.loops > 0 || (known && meter.maxPos >= duration - 1);
  return { progress, completed };
}
