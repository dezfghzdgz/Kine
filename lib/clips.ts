import { formatTime } from './playerControls';

/**
 * Klipy - vystřižení kusu videa (čistá rozhodnutí, tests/clips.test.mjs).
 *
 * PROČ
 *
 * Krátký klip je to, co se šíří: nikdo neposílá kamarádovi odkaz na
 * dvanáctiminutový záznam kvůli jednomu momentu ve 7:40. Twitch na klipech
 * vyrostl. Divák u videa označí od-do, Cloudflare Stream z toho vyrobí
 * nové krátké video (API "clip" - nic se nestahuje ani nepřekódovává na
 * našem serveru) a to se dá poslat dál s odkazem zpět na celé video.
 *
 * PRAVIDLA
 *  - klip vlastní PŮVODNÍ TVŮRCE (zhlédnutí a výdělky zůstávají jemu),
 *    kdo ho vystřihl, je u něj uvedený - jako na Twitchi;
 *  - klipovat jde jen veřejné, hotové video, 3 až 60 sekund;
 *  - klipy se nepočítají do denního limitu nahrávání tvůrce a odběratelům
 *    se o nich neposílá oznámení (nejsou to nová videa tvůrce).
 */

export const CLIP_MIN_S = 3;
export const CLIP_MAX_S = 60;
/** Kolik klipů smí jeden účet vystřihnout za den - každý klip je nové video u Cloudflare. */
export const CLIPS_PER_DAY = 30;

export type ClipRange = { start: number; end: number };

export type ClipRangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; reason: 'too-short' | 'too-long' | 'out-of-range' | 'invalid' };

/**
 * Srovná zadaný rozsah s délkou videa. Vrací celé sekundy; začátek se
 * ořízne na 0 a konec na délku videa. Příliš dlouhý rozsah je chyba
 * (ne tiché zkrácení) - divák má vědět, co dostane.
 */
export function normalizeClipRange(start: number, end: number, duration: number): ClipRangeResult {
  if (![start, end, duration].every((n) => Number.isFinite(n))) return { ok: false, reason: 'invalid' };
  if (duration <= 0) return { ok: false, reason: 'invalid' };

  const s = Math.max(0, Math.floor(start));
  const e = Math.min(Math.floor(duration), Math.ceil(end));
  if (s >= Math.floor(duration)) return { ok: false, reason: 'out-of-range' };
  if (e <= s) return { ok: false, reason: 'too-short' };

  const length = e - s;
  if (length < CLIP_MIN_S) return { ok: false, reason: 'too-short' };
  if (length > CLIP_MAX_S) return { ok: false, reason: 'too-long' };
  return { ok: true, start: s, end: e };
}

/**
 * Výchozí rozsah po kliknutí na "Klip": posledních 30 sekund před
 * aktuálním časem (jako na Twitchi), u krátkého videa celé video.
 */
export function defaultClipRange(currentTime: number, duration: number, length = 30): ClipRange {
  const total = Math.max(0, Math.floor(duration));
  const now = Math.min(total, Math.max(0, Math.floor(currentTime)));
  const span = Math.min(length, CLIP_MAX_S, total);
  let end = now;
  let start = end - span;
  if (start < 0) {
    start = 0;
    end = Math.min(total, span);
  }
  // Na začátku videa (čas 0) by vyšel prázdný rozsah - vezme se prvních N sekund.
  if (end - start < Math.min(CLIP_MIN_S, total)) {
    start = 0;
    end = Math.min(total, span);
  }
  return { start, end };
}

/** Název klipu: název videa + časy. Bez překladu - název je text v databázi, stejný pro všechny jazyky. */
export function clipTitle(originalTitle: string, start: number, end: number): string {
  const base = (originalTitle ?? '').trim() || 'Video';
  const suffix = ` · ${formatTime(start)}–${formatTime(end)}`;
  // Názvy mají strop 150 znaků (app/api/videos/confirm) - zkrátí se původní, ne časy.
  const room = 150 - suffix.length;
  const head = base.length > room ? base.slice(0, room - 1).trimEnd() + '…' : base;
  return head + suffix;
}

/** "m:ss" nebo "h:mm:ss" -> sekundy; nesmysl -> null. */
export function parseClipTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) {
    // Samotné číslo bez dvojtečky bereme jako sekundy.
    if (/^\d+$/.test(text.trim())) return Number(text.trim());
    return null;
  }
  const nums = parts.map(Number);
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}
