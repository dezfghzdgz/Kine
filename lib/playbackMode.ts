import { isSpark } from './videoBlocks';

/**
 * Jak se má video přehrávat.
 *
 * Patnáct kategorií neznamená patnáct přehrávačů - liší se jen čtyři
 * situace: posloucháš, koukáš na dlouhé, koukáš na krátké, nebo scrolluješ.
 * Kategorie proto nevybírá vzhled, ale jeden ze čtyř režimů.
 *
 * Nic pro to nebylo potřeba přidávat do databáze: kategorii u videa už máš
 * a ukládá se jako klíč překladu ('catMusic'), takže je to napříč jazyky
 * pořád to samé.
 */

export type PlaybackMode = 'sparks' | 'music' | 'film' | 'classic';

const MUSIC_CATEGORIES = new Set(['catMusic']);

// Film zatím jen v mapě - vzhled pro něj (ztlumené okolí, kapitoly a
// titulky napřed, žádné auto-další) je samostatný krok.
const FILM_CATEGORIES = new Set(['catFilm', 'catEducation', 'catScience']);

/**
 * Tvar videa má přednost před kategorií: svislé krátké video je Sparks,
 * i kdyby si ho tvůrce zařadil do Hudby. Kdo scrolluje Sparks, nechce
 * mezi nimi narazit na obal alba.
 */
export function playbackMode(video: any): PlaybackMode {
  if (!video) return 'classic';
  if (isSpark(video)) return 'sparks';
  if (MUSIC_CATEGORIES.has(video.category)) return 'music';
  if (FILM_CATEGORIES.has(video.category)) return 'film';
  return 'classic';
}

export function isMusicVideo(video: any): boolean {
  return playbackMode(video) === 'music';
}
