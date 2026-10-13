/**
 * Deník živého vysílání: kdy přenos začal, kdy ho Cloudflare potvrdil, kdy
 * a PROČ skončil (a kdy ho skryla kontrola obsahu). Píše se jen do logu
 * serveru (Vercel -> Logs, hledat "Kine živě") - stránka s diagnostikou
 * (/admin/live) je pryč a do databáze se nic nezapisuje.
 */

export type LiveEventKind = 'start' | 'confirm' | 'end' | 'stop' | 'unconfirmed' | 'silent-end' | 'hidden' | 'unseen';

/** Stejná událost téhož kanálu nejvýš jednou za tolik (jedna instance serveru) - deník nezaplaví ani blikání. */
const SAME_EVENT_GAP_MS = 15 * 1000;
const lastWritten = new Map<string, number>();

/** Krátké podrobnosti na řádky "klíč: hodnota". */
export function liveEventDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v === null ? '-' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n')
    .slice(0, 2000);
}

/** Kolik vteřin uběhlo od času v ISO (null = nikdy / neznámo). */
export function secondsSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((now - t) / 1000) : null;
}

/**
 * Zapíše událost do logu serveru (nic nečeká, nic nemůže rozbít vysílání).
 */
export function logLiveEvent(ownerId: string, kind: LiveEventKind, summary: string, details: Record<string, unknown> = {}): void {
  const key = `${ownerId}:${kind}`;
  const now = Date.now();
  const last = lastWritten.get(key);
  if (last && now - last < SAME_EVENT_GAP_MS) return;
  lastWritten.set(key, now);
  if (lastWritten.size > 2000) {
    for (const [k, at] of lastWritten) if (now - at > SAME_EVENT_GAP_MS) lastWritten.delete(k);
  }
  console.info(`Kine živě [${kind}] ${ownerId}: ${summary}`, liveEventDetails(details).replace(/\n/g, ' | '));
}
