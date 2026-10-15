import { supabaseServer } from './supabaseServer';
import { isMissingTable } from './apiUser';

/**
 * Videa u Cloudflare Stream: bezpečné mazání a fronta na opakování.
 *
 * Každá smazaná minuta u Cloudflare = méně peněz za úložiště, každé smazání
 * navíc = cizí video navždy pryč. Proto:
 *   - id videa musí vypadat jako id od Cloudflare (32 hex znaků) - nic jiného
 *     se do adresy API nedostane,
 *   - nesmaže se video, na které pořád ukazuje nějaký řádek v naší databázi,
 *   - když Cloudflare zrovna neodpoví, smazání se zapíše do fronty
 *     (tabulka cloudflare_cleanup) a úklid (/api/videos/sweep) ho zopakuje -
 *     dřív takové video zůstalo u Cloudflare napořád a platilo se za něj.
 */

export const CLOUDFLARE_UID = /^[a-f0-9]{32}$/i;

export function isCloudflareUid(value: unknown): value is string {
  return typeof value === 'string' && CLOUDFLARE_UID.test(value);
}

export function cloudflareStreamCreds(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  return accountId && token ? { accountId, token } : null;
}

export function streamApiUrl(accountId: string, path: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/stream${path}`;
}

export type DeleteOutcome = 'deleted' | 'gone' | 'failed' | 'kept';

/** Smaže video u Cloudflare. 'gone' = už tam není, 'failed' = nevyšlo (síť, chyba). */
export async function deleteStreamVideo(uid: string): Promise<DeleteOutcome> {
  if (!isCloudflareUid(uid)) return 'gone';
  const cf = cloudflareStreamCreds();
  if (!cf) return 'failed';
  try {
    const res = await fetch(streamApiUrl(cf.accountId, `/${encodeURIComponent(uid)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${cf.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return 'deleted';
    if (res.status === 404) return 'gone';
    return 'failed';
  } catch {
    return 'failed';
  }
}

/** Údaje o videu u Cloudflare, null = není (404), undefined = nevíme (síť, chyba). */
export async function getStreamVideo(uid: string): Promise<any | null | undefined> {
  if (!isCloudflareUid(uid)) return null;
  const cf = cloudflareStreamCreds();
  if (!cf) return undefined;
  try {
    const res = await fetch(streamApiUrl(cf.accountId, `/${encodeURIComponent(uid)}`), {
      headers: { Authorization: `Bearer ${cf.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return undefined;
    return body.result ?? null;
  } catch {
    return undefined;
  }
}

/** Ukazuje na video u Cloudflare nějaký řádek v databázi (kromě `exceptVideoId`)? Při chybě radši ano. */
export async function cloudflareUidInUse(uid: string, exceptVideoId?: string): Promise<boolean> {
  let query = supabaseServer.from('videos').select('id').eq('cloudflare_video_id', uid).limit(2);
  if (exceptVideoId) query = query.neq('id', exceptVideoId);
  const { data, error } = await query;
  if (error) return true;
  return (data ?? []).length > 0;
}

/**
 * Zapíše smazání do fronty (když tabulka ještě není - migrace - jen do logu).
 * `delayMs`: kdy nejdřív smazat (video smazané moderátorem čeká 7 dní - kdyby
 * šlo o omyl nebo ukradený účet, správce ho do té doby vrátí).
 */
export async function queueCloudflareDelete(uid: string, reason: string, delayMs = 5 * 60 * 1000): Promise<boolean> {
  if (!isCloudflareUid(uid)) return false;
  const { error } = await supabaseServer
    .from('cloudflare_cleanup')
    .upsert({ uid, reason: reason.slice(0, 200), next_try_at: new Date(Date.now() + delayMs).toISOString() }, { onConflict: 'uid' });
  if (error) console.error('Kine: video u Cloudflare se nesmazalo a fronta není (migrace zabezpeceni-a-limity)', uid, isMissingTable(error) ? '' : error.message);
  return !error;
}

/**
 * Smaže video u Cloudflare, nebo ho dá do fronty na později. Nesmaže nic, na
 * co ukazuje jiný řádek v databázi (`exceptVideoId` = řádek, který se právě maže).
 */
export async function deleteOrQueue(uid: string, reason: string, exceptVideoId?: string): Promise<DeleteOutcome> {
  if (!isCloudflareUid(uid)) return 'gone';
  if (await cloudflareUidInUse(uid, exceptVideoId)) return 'kept';
  const outcome = await deleteStreamVideo(uid);
  if (outcome === 'failed') await queueCloudflareDelete(uid, reason);
  return outcome;
}

/** Úklid: zopakuje smazání z fronty (nejvýš `max` naráz). Nikdy nehodí chybu. */
export async function processCloudflareCleanup(max = 10): Promise<number> {
  let done = 0;
  try {
    const { data, error } = await supabaseServer
      .from('cloudflare_cleanup')
      .select('uid, attempts')
      .lte('next_try_at', new Date().toISOString())
      .order('next_try_at', { ascending: true })
      .limit(max);
    if (error || !data) return 0;
    for (const row of data as { uid: string; attempts: number | null }[]) {
      // Mezitím na video začal ukazovat řádek (obnovené / znovu potvrzené)? Pak se nemaže.
      if (await cloudflareUidInUse(row.uid)) {
        await supabaseServer.from('cloudflare_cleanup').delete().eq('uid', row.uid);
        continue;
      }
      const outcome = await deleteStreamVideo(row.uid);
      if (outcome === 'deleted' || outcome === 'gone') {
        await supabaseServer.from('cloudflare_cleanup').delete().eq('uid', row.uid);
        done += 1;
      } else {
        const attempts = (row.attempts ?? 0) + 1;
        const waitMs = Math.min(24 * 3600 * 1000, 5 * 60 * 1000 * 2 ** Math.min(attempts, 8));
        await supabaseServer
          .from('cloudflare_cleanup')
          .update({ attempts, last_error: 'Cloudflare neodpověděl', next_try_at: new Date(Date.now() + waitMs).toISOString() })
          .eq('uid', row.uid);
      }
    }
  } catch {
    // Úklid nesmí shodit dotaz, ze kterého se volá.
  }
  return done;
}
