import type { MusicTrack, RepeatMode } from './musicPlayer';

/**
 * Rozhodování hudebního přehrávače - bez Reactu, ať se dá otestovat.
 *
 * Přehrávač má dva sloty. Jeden hraje, druhý si potichu dopředu načítá
 * skladbu, která přijde na řadu. Bez toho začínal každý další kousek od
 * nuly: nový iframe, stáhnout skript Cloudflare, manifest, první kus
 * zvuku - a mezi skladbami bylo několik vteřin ticha.
 *
 * Tady je jen ta úvaha "co pustit dál a kam to načíst". Samotné
 * přehrávání zůstává v lib/musicPlayer.tsx.
 */

/**
 * Slot přehrávače.
 *
 * `autoplay` a `muted` jsou parametry adresy iframu a rozhodují se JEDNOU,
 * při vzniku slotu - podle toho, jestli vzniká jako hrající, nebo jako
 * dopředu načtený. Nesmí se odvozovat od toho, který slot je zrovna
 * aktivní: adresa iframu by se pak při přepnutí změnila a iframe by se
 * celý načetl znovu - jako nový přehrávač, o kterém naše napojení nic
 * neví. Přesně tak vznikal "duch": zvuk hrál, ale pauza ani ztlumení na
 * něj nedosáhly.
 */
export type Slot = { key: string; track: MusicTrack | null; autoplay?: boolean; muted?: boolean };
export type Slots = [Slot, Slot];
export type SlotIndex = 0 | 1;

export type NextOptions = {
  shuffle: boolean;
  repeat: RepeatMode;
  /** Jen kvůli testu - v appce je to Math.random. */
  random?: () => number;
};

/**
 * Která skladba přijde na řadu.
 *
 * Vrací null, když už nic dalšího není (konec fronty bez opakování).
 */
export function chooseNext(
  list: MusicTrack[],
  currentId: string | null,
  { shuffle, repeat, random = Math.random }: NextOptions
): MusicTrack | null {
  if (list.length === 0 || !currentId) return null;

  const index = list.findIndex((item) => item.id === currentId);

  if (shuffle) {
    if (list.length === 1) return repeat === 'all' ? list[0] : null;
    // Náhodně, ale nikdy to samé znovu hned po sobě.
    let candidate = index;
    while (candidate === index) candidate = Math.floor(random() * list.length);
    return list[candidate];
  }

  if (index === -1) return list[0];
  if (index + 1 < list.length) return list[index + 1];
  return repeat === 'all' ? list[0] : null;
}

/** Skladba o krok zpět. Null znamená "zůstaň, kde jsi". */
export function choosePrevious(
  list: MusicTrack[],
  currentId: string | null,
  repeat: RepeatMode
): MusicTrack | null {
  if (list.length === 0 || !currentId) return null;
  const index = list.findIndex((item) => item.id === currentId);
  if (index > 0) return list[index - 1];
  if (repeat === 'all') return list[list.length - 1];
  return null;
}

export type SwapPlan = {
  slots: Slots;
  active: SlotIndex;
  /**
   * Byla skladba už předem načtená?
   *
   * Tohle je celý smysl dvou slotů. Když je true, přepnutí je okamžité;
   * když false, znamená to čekání na nový iframe.
   */
  reused: boolean;
};

/** Připraví přesun přehrávání do druhého slotu. */
export function planSwap(slots: Slots, active: SlotIndex, next: MusicTrack, newKey: string): SwapPlan {
  const to: SlotIndex = active === 0 ? 1 : 0;
  const reused = slots[to].track?.id === next.id;

  const updated: Slots = [slots[0], slots[1]];
  // Nový slot vzniká jako hrající: rozjede se sám, se zvukem.
  if (!reused) updated[to] = { key: newKey, track: next, autoplay: true, muted: false };

  return { slots: updated, active: to, reused };
}

/**
 * Co načíst dopředu do slotu, který zrovna nehraje.
 *
 * Vrací null, když je tam už to správné (nebo když není co načítat) -
 * v tom případě se nesmí sahat na iframe, jinak by se načítal pořád
 * dokola.
 */
export function planPreload(
  slots: Slots,
  active: SlotIndex,
  upcoming: MusicTrack | null,
  newKey: string
): { slots: Slots; idle: SlotIndex } | null {
  if (!upcoming) return null;

  const idle: SlotIndex = active === 0 ? 1 : 0;
  if (slots[idle].track?.id === upcoming.id) return null;

  const updated: Slots = [slots[0], slots[1]];
  // Dopředu načtený slot vzniká potichu a stojí; zvuk a start mu dá až
  // přepnutí přes SDK, které na něj v tu chvíli už dávno dosáhne.
  updated[idle] = { key: newKey, track: upcoming, autoplay: false, muted: true };
  return { slots: updated, idle };
}
