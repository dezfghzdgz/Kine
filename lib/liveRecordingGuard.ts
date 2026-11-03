/**
 * Pojistky zveřejnění záznamu vysílání (lib/liveRecording.ts - publishRecording) -
 * čistá logika bez databáze (tests/apiHardening.test.mjs).
 */

/** O tolik dřív než náš začátek přenosu může Cloudflare založit jeho záznam. */
export const RECORDING_START_SLACK_MS = 2 * 60 * 1000;

type RecordingLike = { created: string | null; duration: number | null };
type StreamLike = { is_live?: boolean | null; started_at?: string | null; ended_at?: string | null } | null | undefined;

function ms(value: string | null | undefined): number {
  return value ? Date.parse(value) : NaN;
}

/**
 * Délka záznamu pro kontrolu úložiště (sekundy). Cloudflare ji u záznamu, který
 * po konci vysílání ještě uzavírá, hlásí jako -1 (u nás null) - a právě v tu chvíli
 * běží automatické zveřejnění. Dřív se pak počítalo s nulou a do plného úložiště
 * prošel i dvanáctihodinový záznam. Teď odhad z databáze: od založení záznamu
 * (jinak od začátku přenosu) do konce přenosu (běžící přenos: teď). Bez údajů
 * opatrně strop jednoho přenosu (`fallbackSeconds`).
 */
export function estimatedRecordingSeconds(rec: RecordingLike, stream: StreamLike, fallbackSeconds: number, now = Date.now()): number {
  if (typeof rec.duration === 'number' && Number.isFinite(rec.duration) && rec.duration > 0) return rec.duration;
  const created = ms(rec.created);
  const started = ms(stream?.started_at);
  const start = Number.isFinite(created) ? created : started;
  if (!Number.isFinite(start)) return fallbackSeconds;
  const ended = stream?.is_live ? now : ms(stream?.ended_at);
  const end = Number.isFinite(ended) && ended >= start ? ended : now;
  return Math.min(fallbackSeconds, Math.max(0, Math.round((end - start) / 1000)));
}

/**
 * Patří záznam k (poslednímu) přenosu z řádku live_streams? Záznam vzniká se
 * začátkem přenosu, takže jeho založení je nejdřív chvíli před naším začátkem.
 * Záznam bez data se bere jako patřící (opatrnost - skrytý přenos se nezveřejní).
 */
export function recordingBelongsToStream(rec: { created: string | null }, stream: StreamLike): boolean {
  const started = ms(stream?.started_at);
  if (!Number.isFinite(started)) return false;
  const created = ms(rec.created);
  if (!Number.isFinite(created)) return true;
  return created >= started - RECORDING_START_SLACK_MS;
}
