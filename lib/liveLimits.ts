import { supabaseServer } from './supabaseServer';
import { cloudflareStreamCreds, cloudflareUidInUse, deleteStreamVideo, isCloudflareUid, streamApiUrl } from './cloudflareVideos';

/**
 * Vysílání nesmí stát peníze bez konce (každá minuta záznamu leží
 * v úložišti Cloudflare, každá minuta pro diváky se platí):
 *
 *  - Zablokovaný účet: vstup pro vysílání se u Cloudflare vypne (OBS se
 *    nepřipojí). Dřív zablokování zastavilo jen hlášení z appky - OBS
 *    vysílal dál. Po odblokování se vstup zase zapne.
 *  - Přenos delší než LIVE_MAX_HOURS (výchozí 12 h): vstup se vypne na
 *    LIVE_COOLDOWN_MINUTES (15 min) - nekonečný přenos 24/7 by zaplnil
 *    úložiště všem. Délku bere od Cloudflare (jak dlouho je vstup připojený),
 *    ne z naší databáze.
 *  - Nezveřejněné záznamy vysílání se smažou po LIVE_RECORDING_KEEP_DAYS
 *    (výchozí 7 dní, jako na Twitchi; dřív 30). Zveřejněné zůstávají.
 *
 * Volá se z úklidu (lib/markVideoReady.ts - sweepProcessing) a z denního
 * cronu; sám si hlídá, aby neběžel častěji než jednou za 5 minut.
 */

const EVERY_MS = 5 * 60 * 1000;
let lastRun = 0;
let running = false;

export function liveMaxHours(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LIVE_MAX_HOURS);
  return Number.isFinite(n) && n >= 1 && n <= 48 ? n : 12;
}

export function recordingKeepDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.LIVE_RECORDING_KEEP_DAYS);
  return Number.isFinite(n) && n >= 1 && n <= 30 ? Math.round(n) : 7;
}

const COOLDOWN_MINUTES = 15;

async function cfLive(path: string, init: RequestInit = {}): Promise<any | null> {
  const cf = cloudflareStreamCreds();
  if (!cf) return null;
  try {
    const res = await fetch(streamApiUrl(cf.accountId, path), {
      ...init,
      headers: { Authorization: `Bearer ${cf.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return null;
    return body.result ?? {};
  } catch {
    return null;
  }
}

const INPUT_ID = /^[a-f0-9]{32}$/i;

/** Zapne / vypne vstup pro vysílání u Cloudflare. */
export async function setLiveInputEnabled(inputId: string, enabled: boolean): Promise<boolean> {
  if (!INPUT_ID.test(inputId)) return false;
  return (await cfLive(`/live_inputs/${encodeURIComponent(inputId)}`, { method: 'PUT', body: JSON.stringify({ enabled }) })) !== null;
}

/** Od kdy je vstup připojený (ms), null = není připojený / nevíme. */
async function connectedSince(inputId: string): Promise<number | null> {
  if (!INPUT_ID.test(inputId)) return null;
  const input = await cfLive(`/live_inputs/${encodeURIComponent(inputId)}`);
  const current = input?.status?.current;
  if (current?.state !== 'connected') return null;
  const since = Date.parse(String(current.statusEnteredAt ?? current.statusLastSeen ?? ''));
  return Number.isFinite(since) ? since : null;
}

type InputRow = { owner_id: string; cf_input_id: string | null; disabled_reason?: string | null; disabled_until?: string | null };

async function disableInput(row: InputRow, reason: 'ban' | 'too-long', until: string | null): Promise<void> {
  if (!row.cf_input_id) return;
  if (!(await setLiveInputEnabled(row.cf_input_id, false))) return;
  await supabaseServer
    .from('live_inputs')
    .update({ disabled_at: new Date().toISOString(), disabled_reason: reason, disabled_until: until })
    .eq('owner_id', row.owner_id);
}

async function enableInput(row: InputRow): Promise<void> {
  if (!row.cf_input_id) return;
  if (!(await setLiveInputEnabled(row.cf_input_id, true))) return;
  await supabaseServer.from('live_inputs').update({ disabled_at: null, disabled_reason: null, disabled_until: null }).eq('owner_id', row.owner_id);
}

/**
 * Přestávka po moc dlouhém přenosu už skončila: vstup zapnout hned, když se
 * tvůrce podívá do studia - ne až při dalším úklidu (ten běží nejvýš jednou
 * za 5 minut a jen když se někdo na něco ptá). True = vstup je zase zapnutý.
 */
export async function reenableIfCooledDown(row: InputRow & { disabled_at?: string | null }): Promise<boolean> {
  if (!row.disabled_at || row.disabled_reason !== 'too-long') return false;
  const until = row.disabled_until ? Date.parse(row.disabled_until) : NaN;
  if (Number.isFinite(until) && until > Date.now()) return false;
  if (!row.cf_input_id || !(await setLiveInputEnabled(row.cf_input_id, true))) return false;
  await supabaseServer.from('live_inputs').update({ disabled_at: null, disabled_reason: null, disabled_until: null }).eq('owner_id', row.owner_id);
  return true;
}

export async function enforceLiveLimits(options: { force?: boolean } = {}): Promise<void> {
  if (running) return;
  if (!options.force && Date.now() - lastRun < EVERY_MS) return;
  if (!cloudflareStreamCreds()) return;
  lastRun = Date.now();
  running = true;
  try {
    // 1. Zablokované účty: vstup vypnout.
    const banned = await supabaseServer
      .from('live_inputs')
      .select('owner_id, cf_input_id, disabled_reason, profiles!inner(is_banned)')
      .eq('profiles.is_banned', true)
      .is('disabled_at', null)
      .limit(50);
    if (!banned.error) for (const row of (banned.data ?? []) as InputRow[]) await disableInput(row, 'ban', null);

    // 2. Odblokované účty: vstup zase zapnout.
    const unbanned = await supabaseServer
      .from('live_inputs')
      .select('owner_id, cf_input_id, disabled_reason, profiles!inner(is_banned)')
      .eq('profiles.is_banned', false)
      .eq('disabled_reason', 'ban')
      .limit(50);
    if (!unbanned.error) for (const row of (unbanned.data ?? []) as InputRow[]) await enableInput(row);

    // 3. Přenos delší než strop: vstup na chvíli vypnout (Cloudflare přenos ukončí).
    const maxMs = liveMaxHours() * 3600 * 1000;
    const longLive = await supabaseServer
      .from('live_streams')
      .select('owner_id, cf_input_id, started_at')
      .eq('is_live', true)
      .lt('started_at', new Date(Date.now() - maxMs).toISOString())
      .limit(20);
    if (!longLive.error) {
      for (const s of (longLive.data ?? []) as { owner_id: string; cf_input_id: string | null }[]) {
        if (!s.cf_input_id) continue;
        const since = await connectedSince(s.cf_input_id);
        if (since === null || Date.now() - since < maxMs) continue;
        await disableInput({ owner_id: s.owner_id, cf_input_id: s.cf_input_id }, 'too-long', new Date(Date.now() + COOLDOWN_MINUTES * 60 * 1000).toISOString());
      }
    }

    // 4. Po přestávce zase zapnout.
    const cooled = await supabaseServer
      .from('live_inputs')
      .select('owner_id, cf_input_id, disabled_reason, disabled_until')
      .eq('disabled_reason', 'too-long')
      .lt('disabled_until', new Date().toISOString())
      .limit(50);
    if (!cooled.error) for (const row of (cooled.data ?? []) as InputRow[]) await enableInput(row);

    // 5. Staré nezveřejněné záznamy (jen v denním cronu - stojí to dotaz na seznam u Cloudflare).
    if (options.force) await cleanupOldRecordings();
  } catch {
    // Úklid nesmí shodit dotaz, ze kterého se volá.
  } finally {
    running = false;
  }
}

/** Záznam z výpisu Cloudflare: nezveřejněný (naplánované smazání), ne živý, starší než hranice. */
export function expiredRecording(v: any, cutoffMs: number): string | null {
  const uid = String(v?.uid ?? '');
  if (!isCloudflareUid(uid) || !v?.liveInput || !v?.scheduledDeletion) return null;
  if (String(v?.status?.state ?? '').startsWith('live')) return null;
  const created = Date.parse(String(v?.created ?? ''));
  if (!Number.isFinite(created) || created > cutoffMs) return null;
  return uid;
}

/**
 * Smaže nezveřejněné záznamy vysílání starší než recordingKeepDays().
 * Nezveřejněný = Cloudflare ho má naplánovaný ke smazání (scheduledDeletion,
 * zveřejnění to plánování ruší - lib/liveStream.ts keepRecording) a žádné
 * video na Kine na něj neukazuje. Nejvýš `max` naráz.
 *
 * Záznamy se hledají po vstupech (kanálech), které za poslední měsíc vysílaly -
 * dřív se bralo jen 200 nejstarších videí celého účtu a mezi nimi byla hlavně
 * obyčejná nahraná videa, takže na záznamy často nedošlo a ležely (a stály)
 * až do automatického smazání po 30 dnech. Na konec ještě starý průchod
 * přes celý účet (záznamy ze smazaných vstupů po změně klíče).
 */
export async function cleanupOldRecordings(max = 150): Promise<number> {
  const cutoffMs = Date.now() - recordingKeepDays() * 24 * 3600 * 1000;
  const seen = new Set<string>();
  let deleted = 0;
  const tryDelete = async (v: any) => {
    const uid = expiredRecording(v, cutoffMs);
    if (!uid || seen.has(uid) || deleted >= max) return;
    seen.add(uid);
    if (await cloudflareUidInUse(uid)) return;
    if ((await deleteStreamVideo(uid)) === 'deleted') deleted += 1;
  };

  // 1. Po vstupech, které vysílaly za posledních 31 dní (starší záznamy Cloudflare smaže sám).
  const since = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  const inputs = await supabaseServer.from('live_streams').select('cf_input_id').not('started_at', 'is', null).gte('started_at', since).limit(300);
  if (!inputs.error) {
    for (const row of (inputs.data ?? []) as { cf_input_id: string | null }[]) {
      if (deleted >= max) break;
      const id = String(row.cf_input_id ?? '');
      if (!INPUT_ID.test(id)) continue;
      const list = await cfLive(`/live_inputs/${id}/videos`);
      if (!Array.isArray(list)) continue;
      for (const v of list) await tryDelete(v);
    }
  }

  // 2. Celý účet od nejstarších (záznamy vstupů, které už neexistují).
  if (deleted < max) {
    const list = await cfLive(`?before=${encodeURIComponent(new Date(cutoffMs).toISOString())}&asc=true&limit=200`);
    if (Array.isArray(list)) for (const v of list) await tryDelete(v);
  }
  return deleted;
}
