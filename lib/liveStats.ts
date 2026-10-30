import { supabaseServer } from './supabaseServer';
import { liveViewerCount } from './liveStream';

/**
 * Statistiky živého vysílání (migrace supabase-migration-statistiky-prispevky-zamky.sql, část B).
 *
 * Kolik lidí přenos sleduje, ví Cloudflare (lib/liveStream.ts - liveViewerCount).
 * Server si počet pamatuje 30 s (stránky Živě a přenosu se ptají často)
 * a nejvýš jednou za minutu ho zapíše k vysílání (live_session_sample):
 * nejvíc diváků, průměr a poslední chvíli, kdy bylo vysílání živé. Vzorky
 * přicházejí odtud, odkud se na živé přenosy stejně ptá web: řada Živě,
 * stránka přenosu a hlášení z appky během vysílání.
 *
 * Bez migrace se nic nezapisuje (zápis jen tiše selže) a nic se nerozbije.
 */

const VIEWERS_TTL_MS = 30 * 1000;
const viewersCache = new Map<string, { at: number; value: number | null }>();

/** Počet diváků přenosu (z paměti, nebo čerstvě od Cloudflare). */
export async function cachedLiveViewers(inputId: string | null | undefined): Promise<number | null> {
  if (!inputId) return null;
  const hit = viewersCache.get(inputId);
  if (hit && Date.now() - hit.at < VIEWERS_TTL_MS) return hit.value;
  const value = await liveViewerCount(inputId).catch(() => null);
  viewersCache.set(inputId, { at: Date.now(), value });
  if (viewersCache.size > 500) {
    for (const [key, entry] of viewersCache) if (Date.now() - entry.at > VIEWERS_TTL_MS) viewersCache.delete(key);
  }
  return value;
}

/** Počet diváků jen z paměti (bez čekání na Cloudflare); null = zatím nevíme. */
export function peekLiveViewers(inputId: string | null | undefined): number | null {
  if (!inputId) return null;
  const hit = viewersCache.get(inputId);
  return hit && Date.now() - hit.at < VIEWERS_TTL_MS * 2 ? hit.value : null;
}

const SAMPLE_EVERY_MS = 55 * 1000;
const lastSample = new Map<string, number>();

type SampleRow = { owner_id: string; started_at: string | null; title?: string | null; category?: string | null; cf_input_id?: string | null; is_live?: boolean };

/** Zapíše vzorek k vysílání (nejvýš jednou za minutu na instanci; databáze hlídá i víc instancí). */
export async function sampleLiveSession(row: SampleRow, viewers: number | null): Promise<void> {
  if (!row.owner_id || !row.started_at) return;
  const key = `${row.owner_id}:${row.started_at}`;
  const now = Date.now();
  if ((lastSample.get(key) ?? 0) > now - SAMPLE_EVERY_MS) return;
  lastSample.set(key, now);
  if (lastSample.size > 5000) {
    for (const [k, at] of lastSample) if (now - at > SAMPLE_EVERY_MS) lastSample.delete(k);
  }
  const { error } = await supabaseServer.rpc('live_session_sample', {
    p_owner: row.owner_id,
    p_started: row.started_at,
    p_title: String(row.title ?? '').slice(0, 200),
    p_category: row.category ?? null,
    p_viewers: viewers,
  });
  // Bez migrace funkce chybí - nevadí, statistiky se prostě nesbírají.
  if (error && !/live_session_sample|function|schema cache/i.test(error.message ?? '')) {
    console.warn('Kine: vzorek statistik vysílání se nezapsal -', error.message);
  }
}

/** Diváci + vzorek pro živý přenos (na pozadí - nikdy nebrzdí odpověď). */
export async function sampleLiveRow(row: SampleRow): Promise<number | null> {
  if (!row.is_live) return null;
  const viewers = await cachedLiveViewers(row.cf_input_id);
  await sampleLiveSession(row, viewers);
  return viewers;
}

export type LiveSessionStats = {
  id: string;
  startedAt: string;
  endedAt: string;
  durationS: number;
  title: string;
  peakViewers: number;
  avgViewers: number | null;
  chatMessages: number | null;
  tips: { count: number; byCurrency: Record<string, number> } | null;
};

/** Průměr diváků ze součtu a počtu vzorků (bez vzorků null). */
export function averageViewers(sum: number, samples: number): number | null {
  if (!samples || samples <= 0) return null;
  return Math.round((sum / samples) * 10) / 10;
}

/** Délka vysílání v sekundách (začátek -> poslední chvíle živě), nikdy záporná. */
export function sessionDurationS(startedAt: string, lastSeenAt: string): number {
  const d = (Date.parse(lastSeenAt) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
}
