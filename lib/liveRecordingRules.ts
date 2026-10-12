/**
 * Záznam vysílání -> video: čistá logika bez databáze (tests/liveRecording.test.mjs).
 * Celý postup je v lib/liveRecording.ts.
 */

export type RecordingVisibility = 'public' | 'subscribers' | 'private';
export const RECORDING_VISIBILITIES: RecordingVisibility[] = ['public', 'subscribers', 'private'];

export function parseRecordingVisibility(value: unknown): RecordingVisibility | null {
  return typeof value === 'string' && (RECORDING_VISIBILITIES as string[]).includes(value) ? (value as RecordingVisibility) : null;
}

/** Záznamy hledané pro "poslední" (latest) - starší než tohle už k právě skončenému vysílání nepatří. */
export const LATEST_MAX_AGE_MS = 48 * 60 * 60 * 1000;

type RecordingLike = { uid: string; created: string | null };

/**
 * Který záznam zveřejnit: zadaný (musí patřit k vstupu kanálu - hledá se
 * jen v jeho seznamu), nebo "latest" = nejnovější z posledních 48 hodin,
 * který ještě není mezi `published`.
 */
export function pickRecording<T extends RecordingLike>(recordings: T[], wanted: string, published: Set<string>, now = Date.now()): T | null {
  if (wanted && wanted !== 'latest') return recordings.find((r) => r.uid === wanted) ?? null;
  const fresh = recordings
    .filter((r) => !published.has(r.uid))
    .filter((r) => !r.created || now - new Date(r.created).getTime() < LATEST_MAX_AGE_MS)
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
  return fresh[0] ?? null;
}

export function defaultRecordingTitle(created: string | null): string {
  const date = created ? new Date(created) : new Date();
  return `Live stream ${date.toISOString().slice(0, 10)}`;
}
