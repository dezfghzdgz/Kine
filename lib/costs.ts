import { supabaseServer } from './supabaseServer';
import { cloudflareStreamCreds, streamApiUrl } from './cloudflareVideos';
import { insertedIds, pushNotificationsByIds } from './pushSend';

/**
 * Hlídač nákladů (Admin -> Náklady, a denní kontrola v cronu /api/videos/sweep).
 *
 * Co stojí peníze: Cloudflare Stream - uložené minuty videí (předplacené
 * po 1000 min za $5 měsíčně; po vyčerpání nejde nahrávat ani vysílat) a
 * přehrané minuty ($1 za 1000, platí se zpětně). Plus limity Supabase
 * (databáze a úložiště obrázků). Ceny jdou přepsat v nastavení Vercelu.
 *
 * Přehrané minuty vrací jen token Cloudflare s oprávněním Account Analytics
 * (Read) - bez něj se ukáže „nedostupné“ a zbytek funguje.
 */

/** Varování: `text` česky (oznámení správcům), `en` anglicky (stránka v jiném jazyce). */
export type CostAlert = { level: 'warn' | 'crit'; key: string; text: string; en: string };
export type CostReport = {
  at: string;
  stream: { storedMinutes: number | null; limitMinutes: number | null; videoCount: number | null; error: string | null };
  delivery: { monthMinutes: number | null; todayMinutes: number | null; days: { date: string; minutes: number }[]; error: string | null };
  live: { liveNow: number; minutes30d: number; top: { id: string; name: string; minutes: number }[] };
  uploads: { count24h: number; minutes24h: number; count7d: number; minutes7d: number; top: { id: string; name: string; minutes: number }[] };
  supabase: { dbBytes: number | null; storageBytes: number | null; buckets: Record<string, number>; tables: { name: string; bytes: number }[]; dbLimit: number; storageLimit: number } | null;
  estimate: { storageUsd: number | null; deliveryMonthUsd: number | null; deliveryProjectedUsd: number | null };
  prices: { storagePer1000: number; deliveryPer1000: number };
  alerts: CostAlert[];
};

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function costPrices(env: Record<string, string | undefined> = process.env) {
  return {
    storagePer1000: num(env.CF_STREAM_STORAGE_USD_PER_1000, 5),
    deliveryPer1000: num(env.CF_STREAM_DELIVERY_USD_PER_1000, 1),
  };
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

async function cfJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; body: any }> {
  const cf = cloudflareStreamCreds();
  if (!cf) return { ok: false, body: null };
  try {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${cf.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, body: null };
  }
}

async function streamStorage(): Promise<CostReport['stream']> {
  const cf = cloudflareStreamCreds();
  if (!cf) return { storedMinutes: null, limitMinutes: null, videoCount: null, error: 'Cloudflare Stream není nastavený.' };
  const { ok, body } = await cfJson(streamApiUrl(cf.accountId, '/storage-usage'));
  if (!ok || !body?.success) return { storedMinutes: null, limitMinutes: null, videoCount: null, error: 'Cloudflare úložiště nevrátil.' };
  const r = body.result ?? {};
  return {
    storedMinutes: Number.isFinite(Number(r.totalStorageMinutes)) ? Number(r.totalStorageMinutes) : null,
    limitMinutes: Number.isFinite(Number(r.totalStorageMinutesLimit)) ? Number(r.totalStorageMinutesLimit) : null,
    videoCount: Number.isFinite(Number(r.videoCount)) ? Number(r.videoCount) : null,
    error: null,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function streamDelivery(now: Date): Promise<CostReport['delivery']> {
  const cf = cloudflareStreamCreds();
  if (!cf) return { monthMinutes: null, todayMinutes: null, days: [], error: 'Cloudflare Stream není nastavený.' };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Kvůli porovnání s minulým týdnem i začátkem měsíce: nejvýš 40 dní zpět.
  const from = new Date(Math.min(monthStart.getTime(), now.getTime() - 8 * 86400000));
  const tomorrow = new Date(now.getTime() + 86400000);
  const query = `query($accountTag: string!, $start: Date!, $end: Date!) {
    viewer { accounts(filter: { accountTag: $accountTag }) {
      streamMinutesViewedAdaptiveGroups(limit: 60, filter: { date_geq: $start, date_lt: $end }, orderBy: [date_ASC]) {
        sum { minutesViewed }
        dimensions { date }
      }
    } }
  }`;
  const { ok, body } = await cfJson('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    body: JSON.stringify({ query, variables: { accountTag: cf.accountId, start: isoDate(from), end: isoDate(tomorrow) } }),
  });
  const groups = body?.data?.viewer?.accounts?.[0]?.streamMinutesViewedAdaptiveGroups;
  if (!ok || body?.errors?.length || !Array.isArray(groups)) {
    const denied = JSON.stringify(body?.errors ?? '').match(/auth|permission|access/i);
    return {
      monthMinutes: null,
      todayMinutes: null,
      days: [],
      error: denied ? 'Token Cloudflare nemá oprávnění Account Analytics (Read).' : 'Přehrané minuty se nepodařilo načíst.',
    };
  }
  const days = groups
    .map((g: any) => ({ date: String(g?.dimensions?.date ?? ''), minutes: Math.round(Number(g?.sum?.minutesViewed) || 0) }))
    .filter((d: { date: string }) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
  const monthKey = isoDate(monthStart);
  const today = isoDate(now);
  return {
    monthMinutes: days.filter((d: { date: string }) => d.date >= monthKey).reduce((s: number, d: { minutes: number }) => s + d.minutes, 0),
    todayMinutes: days.find((d: { date: string }) => d.date === today)?.minutes ?? 0,
    days,
    error: null,
  };
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await supabaseServer.from('profiles').select('id, username, display_name').in('id', ids.slice(0, 200));
  for (const p of (data ?? []) as { id: string; username: string | null; display_name: string | null }[]) map.set(p.id, p.display_name || p.username || p.id.slice(0, 8));
  return map;
}

function topBy(rows: { id: string; minutes: number }[], n: number) {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.id, (sums.get(r.id) ?? 0) + r.minutes);
  return [...sums.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function uploadsAndLive(now: Date) {
  const day = new Date(now.getTime() - 86400000).toISOString();
  const week = new Date(now.getTime() - 7 * 86400000).toISOString();
  const month = new Date(now.getTime() - 30 * 86400000).toISOString();
  const [vids, sessions, liveNow] = await Promise.all([
    supabaseServer.from('videos').select('owner_id, duration_seconds, created_at').gte('created_at', week).limit(10000),
    supabaseServer.from('live_sessions').select('owner_id, started_at, last_seen_at').gte('started_at', month).limit(10000),
    supabaseServer.from('live_streams').select('owner_id', { count: 'exact', head: true }).eq('is_live', true),
  ]);
  const videoRows = ((vids.data ?? []) as { owner_id: string; duration_seconds: number | null; created_at: string }[]).map((v) => ({
    id: v.owner_id,
    minutes: Math.max(0, Number(v.duration_seconds) || 0) / 60,
    recent: v.created_at >= day,
  }));
  const sessionRows = ((sessions.error ? [] : sessions.data ?? []) as { owner_id: string; started_at: string; last_seen_at: string }[]).map((s) => ({
    id: s.owner_id,
    minutes: Math.max(0, (Date.parse(s.last_seen_at) - Date.parse(s.started_at)) / 60000),
  }));
  const topUp = topBy(videoRows, 5);
  const topLive = topBy(sessionRows, 5);
  const people = await names([...new Set([...topUp.map(([id]) => id), ...topLive.map(([id]) => id)])]);
  const round = (n: number) => Math.round(n);
  return {
    uploads: {
      count24h: videoRows.filter((v) => v.recent).length,
      minutes24h: round(videoRows.filter((v) => v.recent).reduce((s, v) => s + v.minutes, 0)),
      count7d: videoRows.length,
      minutes7d: round(videoRows.reduce((s, v) => s + v.minutes, 0)),
      top: topUp.map(([id, minutes]) => ({ id, name: people.get(id) ?? id.slice(0, 8), minutes: round(minutes) })),
    },
    live: {
      liveNow: liveNow.count ?? 0,
      minutes30d: round(sessionRows.reduce((s, r) => s + r.minutes, 0)),
      top: topLive.map(([id, minutes]) => ({ id, name: people.get(id) ?? id.slice(0, 8), minutes: round(minutes) })),
    },
  };
}

async function supabaseUsage(env: Record<string, string | undefined>): Promise<CostReport['supabase']> {
  const { data, error } = await supabaseServer.rpc('kine_admin_usage');
  if (error || !data) return null;
  const d = data as { db_bytes?: number; storage?: Record<string, number> | null; tables?: { name: string; bytes: number }[] };
  const buckets = d.storage ?? {};
  return {
    dbBytes: Number.isFinite(Number(d.db_bytes)) ? Number(d.db_bytes) : null,
    storageBytes: d.storage ? Object.values(buckets).reduce((s, b) => s + (Number(b) || 0), 0) : null,
    buckets,
    tables: Array.isArray(d.tables) ? d.tables : [],
    // Limity tarifu Free (Pro má víc - jde přepsat v nastavení Vercelu).
    dbLimit: num(env.SUPABASE_DB_LIMIT_MB, 500) * MB,
    storageLimit: num(env.SUPABASE_STORAGE_LIMIT_GB, 1) * GB,
  };
}

/** Varování z čísel (čisté - tests/costs.test.mjs). */
export function costAlerts(r: Pick<CostReport, 'stream' | 'delivery' | 'uploads' | 'supabase' | 'estimate'>, env: Record<string, string | undefined> = process.env): CostAlert[] {
  const out: CostAlert[] = [];
  const { storedMinutes, limitMinutes } = r.stream;
  if (storedMinutes !== null && limitMinutes && limitMinutes > 0) {
    const share = storedMinutes / limitMinutes;
    const pct = Math.round(share * 100);
    if (share >= 0.95) {
      out.push({
        level: 'crit',
        key: 'storage',
        text: `Úložiště videí je na ${pct} % - brzy nepůjde nahrávat ani vysílat. Dokup minuty u Cloudflare nebo smaž stará videa.`,
        en: `Video storage is at ${pct}% - uploads and live streams will stop soon. Buy more minutes at Cloudflare or delete old videos.`,
      });
    } else if (share >= 0.8) {
      out.push({
        level: 'warn',
        key: 'storage',
        text: `Úložiště videí je na ${pct} % (${Math.round(storedMinutes)} z ${limitMinutes} min).`,
        en: `Video storage is at ${pct}% (${Math.round(storedMinutes)} of ${limitMinutes} min).`,
      });
    }
  }
  const days = r.delivery.days;
  if (days.length >= 3 && r.delivery.todayMinutes !== null) {
    const past = days.slice(-8, -1);
    const avg = past.length ? past.reduce((s, d) => s + d.minutes, 0) / past.length : 0;
    if (r.delivery.todayMinutes > 500 && r.delivery.todayMinutes > avg * 3) {
      out.push({
        level: 'warn',
        key: 'delivery-spike',
        text: `Dnes ${r.delivery.todayMinutes} přehraných minut - víc než trojnásobek běžného dne (${Math.round(avg)}).`,
        en: `${r.delivery.todayMinutes} minutes delivered today - more than three times a normal day (${Math.round(avg)}).`,
      });
    }
  }
  const limitUsd = num(env.COST_ALERT_DELIVERY_USD, 20);
  if (r.estimate.deliveryProjectedUsd !== null && r.estimate.deliveryProjectedUsd > limitUsd) {
    out.push({
      level: 'warn',
      key: 'delivery-cost',
      text: `Přehrávání tento měsíc vyjde odhadem na $${r.estimate.deliveryProjectedUsd.toFixed(2)} (hranice $${limitUsd}).`,
      en: `Delivery this month is projected at $${r.estimate.deliveryProjectedUsd.toFixed(2)} (limit $${limitUsd}).`,
    });
  }
  if (r.uploads.minutes24h > num(env.COST_ALERT_UPLOAD_MINUTES_DAY, 600)) {
    out.push({
      level: 'warn',
      key: 'uploads',
      text: `Za 24 hodin nahráno ${r.uploads.minutes24h} minut videa - nezvykle moc.`,
      en: `${r.uploads.minutes24h} minutes of video uploaded in 24 hours - unusually high.`,
    });
  }
  const sb = r.supabase;
  if (sb?.dbBytes && sb.dbBytes >= sb.dbLimit * 0.8) {
    const used = Math.round(sb.dbBytes / MB);
    const limit = Math.round(sb.dbLimit / MB);
    out.push({
      level: sb.dbBytes >= sb.dbLimit * 0.95 ? 'crit' : 'warn',
      key: 'db',
      text: `Databáze Supabase má ${used} MB z ${limit} MB.`,
      en: `The Supabase database uses ${used} MB of ${limit} MB.`,
    });
  }
  if (sb?.storageBytes && sb.storageBytes >= sb.storageLimit * 0.8) {
    const used = (sb.storageBytes / GB).toFixed(2);
    const limit = (sb.storageLimit / GB).toFixed(0);
    out.push({
      level: sb.storageBytes >= sb.storageLimit * 0.95 ? 'crit' : 'warn',
      key: 'storage-sb',
      text: `Úložiště obrázků Supabase má ${used} GB z ${limit} GB.`,
      en: `Supabase image storage uses ${used} GB of ${limit} GB.`,
    });
  }
  return out;
}

/** Odhad ceny: předplacené úložiště (po 1000 min) a přehrávání tento měsíc + odhad na celý měsíc. */
export function costEstimate(stream: CostReport['stream'], delivery: CostReport['delivery'], prices: { storagePer1000: number; deliveryPer1000: number }, now: Date): CostReport['estimate'] {
  const capacity = stream.limitMinutes ?? stream.storedMinutes;
  const storageUsd = capacity !== null ? Math.ceil(capacity / 1000) * prices.storagePer1000 : null;
  const deliveryMonthUsd = delivery.monthMinutes !== null ? (delivery.monthMinutes / 1000) * prices.deliveryPer1000 : null;
  const dayOfMonth = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const deliveryProjectedUsd = deliveryMonthUsd !== null ? (deliveryMonthUsd / Math.max(1, dayOfMonth)) * daysInMonth : null;
  const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
  return { storageUsd: r2(storageUsd), deliveryMonthUsd: r2(deliveryMonthUsd), deliveryProjectedUsd: r2(deliveryProjectedUsd) };
}

export async function costReport(env: Record<string, string | undefined> = process.env): Promise<CostReport> {
  const now = new Date();
  const prices = costPrices(env);
  const [stream, delivery, ul, supabase] = await Promise.all([streamStorage(), streamDelivery(now), uploadsAndLive(now), supabaseUsage(env)]);
  const estimate = costEstimate(stream, delivery, prices, now);
  const base = { stream, delivery, uploads: ul.uploads, supabase, estimate };
  return { at: now.toISOString(), ...base, live: ul.live, prices, alerts: costAlerts(base, env) };
}

/**
 * Denní kontrola (cron): když něco hoří, správci dostanou oznámení (a push).
 * Nejvýš jednou za ~20 hodin, ať se při ručním spuštění úklidu nehromadí.
 */
export async function costAlertCheck(): Promise<number> {
  const report = await costReport();
  if (report.alerts.length === 0) return 0;
  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { count } = await supabaseServer.from('notifications').select('id', { count: 'exact', head: true }).eq('link', '/admin/costs').gte('created_at', since);
  if ((count ?? 0) > 0) return 0;
  const { data: admins } = await supabaseServer.from('profiles').select('id').eq('is_admin', true).limit(20);
  if (!admins?.length) return 0;
  const crit = report.alerts.some((a) => a.level === 'crit');
  const message = `${crit ? '🚨' : '⚠️'} Náklady: ${report.alerts.map((a) => a.text).join(' ')}`.slice(0, 380);
  const { data } = await supabaseServer
    .from('notifications')
    .insert(admins.map((a: { id: string }) => ({ user_id: a.id, type: 'default', message, link: '/admin/costs' })))
    .select('id');
  await pushNotificationsByIds(insertedIds(data));
  return admins.length;
}
