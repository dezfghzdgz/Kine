import { supabaseServer } from './supabaseServer';
import { runInBackground } from './background';

/**
 * Deník živého vysílání: kdy přenos začal, kdy ho Cloudflare potvrdil,
 * kdy a PROČ skončil (a kdy ho skryla kontrola obsahu). Bez toho se
 * "appka hlásí, že vysílám, ale na webu nejsem" nedalo dohledat - stav se
 * mění každých pár vteřin a z databáze je vidět jen ten poslední.
 *
 * Zapisuje se do client_errors (druh "live", tabulka už je a čte ji jen
 * správce) - přehled je na /admin/live (časová osa) a /admin/errors
 * (seskupené podle kanálu a události). Nic nového v Supabase.
 */

export type LiveEventKind = 'start' | 'confirm' | 'end' | 'stop' | 'unconfirmed' | 'silent-end' | 'hidden';

/** Stejná událost téhož kanálu nejvýš jednou za tolik (jedna instance serveru) - deník nezaplaví ani blikání. */
const SAME_EVENT_GAP_MS = 15 * 1000;
const lastWritten = new Map<string, number>();

/** Krátké podrobnosti na řádky "klíč: hodnota" (čte je člověk na /admin/live). */
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
 * Zapíše událost (na pozadí - odpověď divákovi ani appce kvůli tomu nečeká).
 * Chyba zápisu se jen spolkne: deník nesmí rozbít vysílání.
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
  const write = (async () => {
    const { error } = await supabaseServer.from('client_errors').insert({
      kind: 'live',
      message: `Živě: ${summary}`.slice(0, 500),
      stack: liveEventDetails(details) || null,
      url: `/live/${ownerId}`,
      user_agent: 'kine-server',
      device: null,
      user_id: ownerId,
      fingerprint: `live:${ownerId}:${kind}`,
    });
    if (error) throw new Error(error.message);
  })();
  runInBackground(write, 'deník živého vysílání');
}
