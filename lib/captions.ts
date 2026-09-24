/**
 * Titulky a kapitoly - čistá logika (má test).
 *
 * Titulky se u videa ukládají jako seznam { time, text, end? } v sekundách
 * (videos.captions). Starší titulky psané ručně konec nemají - řádek pak
 * platí do dalšího. Import .srt/.vtt (i automatické titulky od Cloudflare,
 * které chodí jako WebVTT) konec má.
 */

export type Caption = { time: number; text: string; end?: number };
export type Chapter = { time: number; title: string };

/** "01:02:03,450" / "02:03.450" / "2:03" -> sekundy; null když to není čas. */
export function parseTimestamp(value: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\s*$/.exec(value);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (min >= 60 && m[1] !== undefined) return null;
  if (s >= 60) return null;
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) / 1000 : 0;
  return h * 3600 + min * 60 + s + frac;
}

function cleanCueText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // značky WebVTT/SRT (<i>, <c.color>, <00:01.000>)
    .replace(/\{\\[^}]*\}/g, '') // značky ASS ve starších SRT ({\an8})
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * SRT i WebVTT jedním parserem: bloky oddělené prázdným řádkem, v každém
 * řádek "začátek --> konec" a pod ním text. Čísla bloků, hlavička WEBVTT,
 * NOTE/STYLE bloky a nastavení za časem se přeskočí.
 */
export function parseSubtitles(input: string): Caption[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const out: Caption[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;
    const [startRaw, restRaw] = lines[idx].split('-->');
    const endRaw = (restRaw ?? '').trim().split(/\s+/)[0] ?? '';
    const start = parseTimestamp(startRaw.trim());
    const end = parseTimestamp(endRaw);
    if (start === null) continue;
    const body = cleanCueText(lines.slice(idx + 1).join('\n'));
    if (!body) continue;
    out.push(end !== null && end > start ? { time: round3(start), end: round3(end), text: body } : { time: round3(start), text: body });
  }
  return out.sort((a, b) => a.time - b.time).slice(0, 5000);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** Titulky jako SRT - pro úpravy v textovém poli a pro stažení. Chybějící konec = začátek dalšího (nejvýš +4 s). */
export function toSrt(captions: Caption[]): string {
  const sorted = [...captions].filter((c) => c.text?.trim()).sort((a, b) => a.time - b.time);
  return sorted
    .map((c, i) => {
      const next = sorted[i + 1]?.time;
      const end = c.end ?? (next !== undefined ? Math.min(next, c.time + 4) : c.time + 4);
      return `${i + 1}\n${srtTime(c.time)} --> ${srtTime(Math.max(end, c.time + 0.5))}\n${c.text.trim()}`;
    })
    .join('\n\n');
}

/** Který řádek titulků platí v čase `t` (s koncem, nebo do dalšího řádku / nejvýš 4 s). */
export function captionAt(sorted: Caption[], t: number): string | null {
  let found: string | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.time > t) break;
    const next = sorted[i + 1]?.time;
    const end = c.end ?? (next !== undefined ? next : c.time + 4);
    if (t >= c.time && t < end) found = c.text;
  }
  return found;
}

/**
 * Kapitoly z popisu videa, jako na YouTube: řádky začínající časem
 * ("0:00 Úvod", "1:23 - Hlavní část", "(12:05) Konec"). Platí jen když
 * první je na začátku (do 5 s), jsou aspoň dvě a časy jdou po sobě.
 */
export function chaptersFromDescription(description: string | null | undefined, duration?: number | null): Chapter[] {
  if (!description) return [];
  const out: Chapter[] = [];
  for (const raw of description.split(/\r?\n/)) {
    const m = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|.]?\s+(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const time = parseTimestamp(m[1]);
    const title = m[2].trim().slice(0, 100);
    if (time === null || !title) continue;
    if (duration && duration > 0 && time >= duration) continue;
    if (out.length > 0 && time <= out[out.length - 1].time) continue;
    out.push({ time, title });
  }
  if (out.length < 2 || out[0].time > 5) return [];
  return out;
}

/** Kapitoly videa: zadané při nahrání, jinak z popisu. */
export function effectiveChapters(video: { chapters?: Chapter[] | null; description?: string | null; duration_seconds?: number | null }): Chapter[] {
  const typed = sanitizeChapters(video.chapters);
  if (typed.length > 0) return typed;
  return chaptersFromDescription(video.description, video.duration_seconds);
}

/**
 * Kapitoly od klienta (web, appka Kine do PC) nebo z databáze: jen
 * { time >= 0, title } s textovým názvem, seřazené, bez dvou na stejném
 * čase, nejvýš 100. Cokoliv jiného (rozbitý JSON, číslo místo názvu) by
 * jinak mohlo shodit stránku videa.
 */
export function sanitizeChapters(raw: unknown): Chapter[] {
  if (!Array.isArray(raw)) return [];
  const list: Chapter[] = [];
  for (const item of raw) {
    const c = item as { time?: unknown; title?: unknown } | null;
    const time = Number(c?.time);
    const title = typeof c?.title === 'string' ? c.title.trim().slice(0, 100) : '';
    if (!Number.isFinite(time) || time < 0 || !title) continue;
    list.push({ time: round3(time), title });
  }
  list.sort((a, b) => a.time - b.time);
  return list.filter((c, i) => i === 0 || c.time > list[i - 1].time).slice(0, 100);
}

/** Titulky od klienta: { time, text, end? }, text nejvýš 500 znaků, konec jen za začátkem, nejvýš 5000 řádků. */
export function sanitizeCaptions(raw: unknown): Caption[] {
  if (!Array.isArray(raw)) return [];
  const list: Caption[] = [];
  for (const item of raw) {
    const c = item as { time?: unknown; text?: unknown; end?: unknown } | null;
    const time = Number(c?.time);
    const text = typeof c?.text === 'string' ? c.text.trim().slice(0, 500) : '';
    if (!Number.isFinite(time) || time < 0 || !text) continue;
    const end = Number(c?.end);
    list.push(Number.isFinite(end) && end > time ? { time: round3(time), end: round3(end), text } : { time: round3(time), text });
  }
  return list.sort((a, b) => a.time - b.time).slice(0, 5000);
}

/** Jazyky, pro které Cloudflare umí titulky vygenerovat (AI). */
export const AUTO_CAPTION_LANGUAGES = ['cs', 'en', 'de', 'es', 'fr', 'pl', 'it', 'nl', 'pt', 'ru', 'ja', 'ko'] as const;

export function autoCaptionLanguage(language: string | null | undefined): string | null {
  const code = (language ?? '').toLowerCase().slice(0, 2);
  return (AUTO_CAPTION_LANGUAGES as readonly string[]).includes(code) ? code : null;
}
