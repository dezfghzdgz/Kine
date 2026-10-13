/**
 * Přepis videa z titulků (components/TranscriptPanel.tsx) - čistá pravidla
 * (tests/transcript.test.mjs).
 */

import type { Caption } from './captions';

/** "1:05" / "1:02:03" */
export function formatCueTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Řádek, který se teď mluví: poslední, který začal (a když má konec, ještě neskončil). -1 = žádný. */
export function activeCaptionIndex(captions: readonly Caption[], time: number): number {
  let found = -1;
  for (let i = 0; i < captions.length; i++) {
    if (captions[i].time <= time) found = i;
    else break;
  }
  if (found < 0) return -1;
  const end = captions[found].end;
  return typeof end === 'number' && time > end + 1.5 ? -1 : found;
}

/** Bez diakritiky a velikosti písmen - "pribeh" najde "Příběh". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Řádky přepisu odpovídající hledání (s původním pořadím). Prázdné hledání = všechno. */
export function filterTranscript(captions: readonly Caption[], query: string): { cue: Caption; index: number }[] {
  const all = captions.map((cue, index) => ({ cue, index }));
  const q = fold(query.trim());
  if (!q) return all;
  return all.filter(({ cue }) => fold(cue.text).includes(q));
}
