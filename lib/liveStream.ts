import { supabaseServer } from './supabaseServer';
import { appPingFresh, appSignalTrusted, connectedFromInputStatus, decideLive, revivedStartedAt, sameStreamReturns, staleWithoutCloudflare } from './liveSignal';
import { autoPublishAfterStream } from './liveRecording';
import { chatSessionSince } from './liveChat';
import { logLiveEvent, secondsSince } from './liveEvents';
import { liveHiddenNow } from './nudityRules';
import { runInBackground } from './background';

export { appPingFresh, appSignalTrusted, APP_PING_FRESH_MS, APP_UNCONFIRMED_MAX_MS } from './liveSignal';

/**
 * Živé vysílání přes Cloudflare Stream Live.
 *
 * JAK TO FUNGUJE
 *
 * Každý kanál si jednou založí "vstup" (live input) - Cloudflare k němu dá
 * adresu serveru (RTMPS) a tajný klíč. Ty tvůrce vloží do OBS (nebo čehokoli,
 * co umí RTMP) a vysílá. Cloudflare vysílání rovnou přehrává divákům a zároveň
 * ho nahrává - po skončení z něj je obyčejné video, které jde na Kine
 * zveřejnit (/api/live/recordings).
 *
 * Kdo je zrovna živě, se zjišťuje jedním dotazem na Cloudflare pro všechny
 * kanály naráz (videa ve stavu "live-inprogress") - nejvýš jednou za
 * SYNC_THROTTLE_MS na instanci serveru. Volá se z míst, kam chodí diváci
 * (řada "Živě" na hlavní stránce, stav kanálu, stránka přenosu), takže
 * nepotřebuje webhook ani nastavování v Cloudflare. Při přechodu do živého
 * vysílání dostanou odběratelé oznámení (jednou za vysílání).
 */

export type LiveStreamRow = {
  owner_id: string;
  cf_input_id: string;
  title: string;
  description: string;
  category: string | null;
  is_live: boolean;
  current_video_uid: string | null;
  started_at: string | null;
  ended_at: string | null;
  checked_at: string | null;
  notified_video_uid: string | null;
  notified_at: string | null;
  /** Kdy naposledy appka (Kine Clipper) ohlásila, že vysílá. Sloupec je z migrace supabase-migration-live-app.sql. */
  app_ping_at?: string | null;
  /** Kdy přenos naposledy viděl Cloudflare. Sloupec je z migrace supabase-migration-bezpecnost-rijen.sql. */
  cf_confirmed_at?: string | null;
  /** Vlastní náhled přenosu (app/api/live/thumbnail). Sloupec je z migrace supabase-migration-zive-3.sql. */
  thumbnail_url?: string | null;
};

/** Nejvýš jednou za tolik se Cloudflare ptá, kdo vysílá. */
const SYNC_THROTTLE_MS = 12 * 1000;
/** Nový přenos do půl hodiny po posledním oznámení se odběratelům znovu nehlásí (výpadek, restart OBS). */
const RENOTIFY_AFTER_MS = 30 * 60 * 1000;

function cloudflare(): { accountId: string; token: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  return accountId && token ? { accountId, token } : null;
}

export function liveConfigured(): boolean {
  return !!cloudflare();
}

/** Kód zákazníka z adresy Cloudflare (customer-<kód>.cloudflarestream.com) - pro přehrávač přenosu. */
let customerCode: string | null = process.env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE || null;

export function codeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /customer-([a-z0-9]+)\.cloudflarestream\.com/i.exec(url);
  return m ? m[1] : null;
}

/** Kód zákazníka: z nastavení, z posledního dotazu na Cloudflare, nebo z náhledu libovolného videa v databázi. */
export async function streamCustomerCode(): Promise<string | null> {
  if (customerCode) return customerCode;
  try {
    const { data } = await supabaseServer
      .from('videos')
      .select('thumbnail_url')
      .like('thumbnail_url', '%cloudflarestream.com%')
      .limit(1);
    const code = codeFromUrl(data?.[0]?.thumbnail_url);
    if (code) customerCode = code;
  } catch {
    // Bez kódu se přehrávač přenosu vezme přes videodelivery.net.
  }
  return customerCode;
}

/** Adresa přehrávače: vstup (hraje, co zrovna běží) na doméně zákazníka, jinak přenos podle id videa. */
export function livePlayerUrl(inputId: string, videoUid: string | null, code: string | null): string {
  if (code) return `https://customer-${code}.cloudflarestream.com/${inputId}/iframe?autoplay=true&letterboxColor=transparent`;
  return `https://iframe.videodelivery.net/${videoUid ?? inputId}?autoplay=true`;
}

async function cfFetch(path: string, init: RequestInit = {}): Promise<any> {
  const cf = cloudflare();
  if (!cf) throw new Error('Cloudflare Stream není nastavený.');
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/stream${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cf.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const message = body?.errors?.[0]?.message ?? `Cloudflare odpověděl ${res.status}`;
    throw new Error(message);
  }
  return body.result;
}

export type CreatedInput = { uid: string; rtmpsUrl: string; streamKey: string; srtUrl: string | null };

/**
 * Založí vstup pro vysílání. Záznam se nahrává automaticky; krátký výpadek
 * (do minuty) se do jednoho záznamu slepí; nezveřejněné záznamy Cloudflare
 * po 30 dnech smaže (zveřejnění mazání zruší).
 */
export async function createLiveInput(name: string): Promise<CreatedInput> {
  const result = await cfFetch('/live_inputs', {
    method: 'POST',
    body: JSON.stringify({
      meta: { name: name.slice(0, 120) },
      recording: { mode: 'automatic', timeoutSeconds: 60 },
      deleteRecordingAfterDays: 30,
    }),
  });
  const rtmpsUrl = result?.rtmps?.url;
  const streamKey = result?.rtmps?.streamKey;
  if (!result?.uid || !rtmpsUrl || !streamKey) throw new Error('Cloudflare nevrátil adresu pro vysílání.');
  const srtUrl = result?.srt?.url && result?.srt?.streamId ? `${result.srt.url}?streamid=${result.srt.streamId}` : null;
  return { uid: result.uid, rtmpsUrl, streamKey, srtUrl };
}

export async function deleteLiveInput(uid: string): Promise<void> {
  try {
    await cfFetch(`/live_inputs/${uid}`, { method: 'DELETE' });
  } catch {
    // Vstup už u Cloudflare není (nebo se nepovedlo) - nový klíč se založí tak jako tak.
  }
}

export type LiveRecording = {
  uid: string;
  state: string;
  created: string | null;
  duration: number | null;
  thumbnail: string | null;
  readyToStream: boolean;
};

/** Záznamy vysílání jednoho vstupu (nejnovější první). Běžící přenos má state "live-inprogress". */
export async function listInputVideos(inputId: string): Promise<LiveRecording[]> {
  const result = await cfFetch(`/live_inputs/${inputId}/videos`);
  const list: any[] = Array.isArray(result) ? result : [];
  return list
    .map((v) => ({
      uid: String(v.uid),
      state: String(v.status?.state ?? v.state ?? ''),
      created: v.created ?? null,
      duration: typeof v.duration === 'number' && v.duration > 0 ? v.duration : null,
      thumbnail: v.thumbnail ?? null,
      readyToStream: !!v.readyToStream,
    }))
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));
}

/** Zveřejněný záznam Cloudflare nesmaže (vstupy mají mazání nezveřejněných po 30 dnech). */
export async function keepRecording(uid: string): Promise<void> {
  try {
    await cfFetch(`/${uid}`, { method: 'POST', body: JSON.stringify({ scheduledDeletion: null }) });
  } catch {
    // Když to nejde, záznam zůstane s plánovaným smazáním - hlásí se v logu Vercelu.
    console.error('Kine: zrušení plánovaného smazání záznamu se nepovedlo', uid);
  }
}

/** Smaže video (záznam vysílání) u Cloudflare - nejde vrátit. */
export async function deleteCloudflareVideo(uid: string): Promise<void> {
  await cfFetch(`/${uid}`, { method: 'DELETE' });
}

export type CloudflareDownload = { status: 'ready' | 'inprogress' | 'error'; url: string | null; percent: number | null };

/**
 * MP4 ke stažení: první požadavek ho u Cloudflare nechá vyrobit (u hodinového
 * záznamu to trvá i pár minut), další jen zjistí, jak daleko je.
 */
export async function requestCloudflareDownload(uid: string): Promise<CloudflareDownload> {
  const result = await cfFetch(`/${uid}/downloads`, { method: 'POST' });
  const mp4 = result?.default ?? null;
  const status = mp4?.status === 'ready' ? 'ready' : mp4?.status === 'error' ? 'error' : 'inprogress';
  const percent = typeof mp4?.percentComplete === 'number' ? Math.max(0, Math.min(100, mp4.percentComplete)) : null;
  return { status, url: typeof mp4?.url === 'string' ? mp4.url : null, percent };
}

/** Údaje o jednom videu u Cloudflare (délka, náhled, rozměry, připravenost). */
export async function cloudflareVideo(uid: string): Promise<any | null> {
  try {
    return await cfFetch(`/${uid}`);
  } catch {
    return null;
  }
}

// ---- kdo je živě --------------------------------------------------------------------

let lastSyncAt = 0;
let syncing: Promise<void> | null = null;

export type InputLifecycle = { live: boolean; videoUid: string | null };

/** Odpovědi lifecycle si server pamatuje pár vteřin (souběžná srovnání se neptají dvakrát). */
const LIFECYCLE_TTL_MS = 5 * 1000;
const lifecycleCache = new Map<string, { at: number; value: InputLifecycle | null }>();

/**
 * Přijímá vstup právě vysílání? Ptá se lifecycle vstupu
 * (customer-<kód>.cloudflarestream.com/<vstup>/lifecycle) - podle toho
 * se řídí i přehrávač Cloudflare, když ukazuje "vysílání nezačalo".
 * null = nejde zjistit (pak rozhoduje jen seznam běžících přenosů).
 */
export async function inputLifecycle(inputId: string): Promise<InputLifecycle | null> {
  const hit = lifecycleCache.get(inputId);
  if (hit && Date.now() - hit.at < LIFECYCLE_TTL_MS) return hit.value;
  const code = await streamCustomerCode();
  const cf = cloudflare();
  if (!code || !cf || !/^[a-z0-9]+$/i.test(inputId)) return null;
  let value: InputLifecycle | null = null;
  try {
    const res = await fetch(`https://customer-${code}.cloudflarestream.com/${inputId}/lifecycle`, {
      headers: { Authorization: `Bearer ${cf.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    if (body && body.isInput === true && typeof body.live === 'boolean') {
      value = { live: body.live, videoUid: typeof body.videoUID === 'string' && body.videoUID ? body.videoUID : null };
    }
  } catch {
    value = null;
  }
  lifecycleCache.set(inputId, { at: Date.now(), value });
  if (lifecycleCache.size > 500) {
    for (const [key, entry] of lifecycleCache) if (Date.now() - entry.at > LIFECYCLE_TTL_MS) lifecycleCache.delete(key);
  }
  return value;
}

/** Stav vstupu z API (záloha za lifecycle) - pár vteřin v paměti jako lifecycle. */
const inputStatusCache = new Map<string, { at: number; value: boolean | null }>();

async function inputStatusFromApi(inputId: string): Promise<boolean | null> {
  const hit = inputStatusCache.get(inputId);
  if (hit && Date.now() - hit.at < LIFECYCLE_TTL_MS) return hit.value;
  let value: boolean | null = null;
  try {
    const result = await Promise.race([
      cfFetch(`/live_inputs/${encodeURIComponent(inputId)}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    value = result ? connectedFromInputStatus((result as any).status) : null;
  } catch {
    value = null;
  }
  inputStatusCache.set(inputId, { at: Date.now(), value });
  if (inputStatusCache.size > 500) {
    for (const [key, entry] of inputStatusCache) if (Date.now() - entry.at > LIFECYCLE_TTL_MS) inputStatusCache.delete(key);
  }
  return value;
}

/**
 * Vysílá vstup? Lifecycle (to samé, podle čeho se řídí přehrávač), a když
 * nejde zjistit, stav vstupu z API. live null = nevíme - pak rozhoduje
 * seznam běžících přenosů (lib/liveSignal.ts, decideLive).
 */
export async function inputSeen(inputId: string): Promise<{ live: boolean | null; videoUid: string | null }> {
  const life = await inputLifecycle(inputId);
  if (life) return life;
  if (!/^[a-z0-9]+$/i.test(inputId)) return { live: null, videoUid: null };
  return { live: await inputStatusFromApi(inputId), videoUid: null };
}

/**
 * Co Cloudflare právě vysílá (seznam běžících přenosů celého účtu) - pro
 * diagnostiku na /admin/live. Na rozdíl od srovnání (syncLiveStreams) nic
 * nemění, jen čte.
 */
export async function cloudflareLiveListing(): Promise<{ ok: boolean; error: string | null; byInput: Map<string, { uid: string; created: string | null }> }> {
  const byInput = new Map<string, { uid: string; created: string | null }>();
  if (!cloudflare()) return { ok: false, error: 'Cloudflare Stream není na serveru nastavený (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_STREAM_API_TOKEN).', byInput };
  try {
    const result = await cfFetch('?status=live-inprogress&asc=false');
    for (const v of Array.isArray(result) ? result : []) {
      if (String(v.status?.state ?? v.state ?? '') !== 'live-inprogress' || !v.liveInput) continue;
      if (!byInput.has(v.liveInput)) byInput.set(v.liveInput, { uid: String(v.uid), created: v.created ?? null });
    }
    return { ok: true, error: null, byInput };
  } catch (e) {
    return { ok: false, error: (e as Error).message, byInput };
  }
}

/**
 * Odvysílaný čas do profilu (odznak Hodiny živě - lib/badges.ts). Jen přenos,
 * který Cloudflare v tomhle vysílání opravdu viděl (žádné "vysílání" bez
 * jediného snímku). Bez migrace posty-ankety funkce chybí - nic se nestane.
 */
async function addLiveSeconds(row: LiveStreamRow, endIso: string): Promise<void> {
  const started = row.started_at ? Date.parse(row.started_at) : NaN;
  const confirmed = Date.parse((row.cf_confirmed_at ?? row.checked_at ?? '') as string);
  const end = Date.parse(endIso);
  if (!Number.isFinite(started) || !Number.isFinite(end) || !Number.isFinite(confirmed) || confirmed < started) return;
  const seconds = Math.round((Math.min(end, confirmed + 90 * 1000) - started) / 1000);
  if (seconds <= 0) return;
  try {
    await supabaseServer.rpc('add_live_seconds', { p_user: row.owner_id, p_seconds: Math.min(seconds, 24 * 3600) });
  } catch {
    // počítadlo není nutné pro vysílání
  }
}

/** Ukončí přenos v databázi (a zveřejní záznam, když si to tvůrce zapnul). */
async function endStream(row: LiveStreamRow, nowIso: string): Promise<void> {
  if (row.is_live) await addLiveSeconds(row, nowIso);
  // Čerstvé hlášení, kterému se už nevěří (Cloudflare přenos dlouho nevidí):
  // smazat ho, ať ho další "pořád vysílám" neoživí - znovu jen "začal jsem".
  await supabaseServer
    .from('live_streams')
    .update({ is_live: false, ended_at: nowIso, checked_at: nowIso, updated_at: nowIso, ...(appPingFresh(row) ? { app_ping_at: null } : {}) })
    .eq('owner_id', row.owner_id);
  // Vysílání skončilo (OBS, nebo appka bez rozloučení): záznam se zveřejní sám, když si to tvůrce zapnul.
  await autoPublishAfterStream(row.owner_id);
}

/**
 * Cloudflare neodpovídá: přenosy, které dlouho nikdo nepotvrdil a appka
 * o nich nehlásí, skončí (lib/liveSignal.ts - staleWithoutCloudflare).
 */
async function endSilentStreams(): Promise<void> {
  const { data: rows } = await supabaseServer.from('live_streams').select('*').eq('is_live', true).limit(200);
  const nowIso = new Date().toISOString();
  for (const row of (rows ?? []) as LiveStreamRow[]) {
    if (!staleWithoutCloudflare(row)) continue;
    logLiveEvent(row.owner_id, 'silent-end', 'ukončeno - Cloudflare dlouho neodpovídá a appka o přenosu nehlásí', {
      'Cloudflare naposledy potvrdil (s)': secondsSince(lastConfirmedIso(row)),
      'appka naposledy hlásila (s)': secondsSince(row.app_ping_at),
      'začátek (s)': secondsSince(row.started_at),
    });
    await endStream(row, nowIso);
  }
}

/** Kdy přenos naposledy potvrdil Cloudflare (sloupec cf_confirmed_at, bez migrace checked_at). */
function lastConfirmedIso(row: LiveStreamRow): string | null {
  return row.cf_confirmed_at !== undefined ? row.cf_confirmed_at ?? null : row.checked_at;
}

/**
 * Srovná stav živých vysílání s Cloudflare. Nikdy nehodí chybu (volá se
 * z odpovědí divákům); nejvýš jednou za SYNC_THROTTLE_MS, souběžná volání
 * počkají na jedno.
 *
 * Kdo je živě, rozhoduje lib/liveSignal.ts (decideLive): seznam běžících
 * přenosů od Cloudflare, lifecycle vstupu (opravdu přijímá vysílání?)
 * a hlášení z appky.
 */
export async function syncLiveStreams(options: { force?: boolean } = {}): Promise<void> {
  if (!cloudflare()) return;
  const now = Date.now();
  if (!options.force && now - lastSyncAt < SYNC_THROTTLE_MS) return;
  if (syncing) return syncing;
  lastSyncAt = now;
  syncing = (async () => {
    let running: any[];
    try {
      // Všechno, co u Cloudflare právě běží živě (jedním dotazem pro celý účet).
      const result = await cfFetch('?status=live-inprogress&asc=false');
      running = (Array.isArray(result) ? result : []).filter(
        (v) => String(v.status?.state ?? v.state ?? '') === 'live-inprogress' && v.liveInput
      );
    } catch (e) {
      console.error('Kine: Cloudflare neřekl, kdo vysílá', (e as Error).message);
      try {
        await endSilentStreams();
      } catch {
        // Databáze zrovna nejde - zkusí se to při dalším dotazu.
      }
      return;
    }
    try {
      for (const v of running) {
        const code = codeFromUrl(v.playback?.hls) ?? codeFromUrl(v.thumbnail);
        if (code) customerCode = code;
      }
      const liveInputs = new Map<string, any>();
      for (const v of running) if (!liveInputs.has(v.liveInput)) liveInputs.set(v.liveInput, v);

      const { data } = await supabaseServer
        .from('live_streams')
        .select('*')
        .or(`is_live.eq.true${liveInputs.size > 0 ? `,cf_input_id.in.(${[...liveInputs.keys()].map((id) => `"${id}"`).join(',')})` : ''}`);
      const rows = (data ?? []) as LiveStreamRow[];

      // Opravdu vysílají? Vstupy, které Cloudflare hlásí jako běžící, i živé přenosy,
      // které v seznamu zrovna chybí (seznam občas běžící přenos vynechá) - souběžně.
      const seen = new Map<string, { live: boolean | null; videoUid: string | null }>();
      await Promise.all(
        rows
          .filter((row) => liveInputs.has(row.cf_input_id) || row.is_live)
          .map(async (row) => seen.set(row.cf_input_id, await inputSeen(row.cf_input_id)))
      );

      const nowIso = new Date().toISOString();
      for (const row of rows) {
        const video = liveInputs.get(row.cf_input_id);
        const life = seen.get(row.cf_input_id) ?? null;
        const decision = decideLive(row, { listed: !!video, connected: life ? life.live : null, videoCreatedAt: video?.created ?? null });
        if (decision === 'confirm') {
          const lifeUid = life?.live && life.videoUid ? life.videoUid : null;
          // Návrat téhož přenosu (stejný záznam u Cloudflare): začátek zůstává - čas vysílání
          // i chat jedou dál. Nový přenos začíná, kdy ho Cloudflare založil (lib/liveSignal.ts).
          const resumed = sameStreamReturns(row, { lifeUid, videoCreatedAt: video?.created ?? null });
          // Běžící video podle lifecycle (to, co hraje přehrávač), jinak první ze seznamu; jinak
          // to, co už je u přenosu - ale jen u téhož přenosu (nový nesmí ukazovat starý záznam).
          const uid = lifeUid || (video ? String(video.uid) : null) || (row.is_live || resumed ? row.current_video_uid ?? null : null);
          // Čas potvrzení od Cloudflare (jen když už sloupec v databázi je).
          const confirmedNow = Object.prototype.hasOwnProperty.call(row, 'cf_confirmed_at') ? { cf_confirmed_at: nowIso } : {};
          if (!row.is_live) {
            logLiveEvent(row.owner_id, 'confirm', resumed ? 'zase živě - Cloudflare vidí tentýž přenos' : 'živě - Cloudflare potvrdil vysílání', {
              'lifecycle (přijímá vysílání)': life ? life.live : 'nejde zjistit',
              'v seznamu běžících': !!video,
              'video': uid,
              'konec minulého (s)': secondsSince(row.ended_at),
              'appka hlásila (s)': secondsSince(row.app_ping_at),
            });
          }
          if (!row.is_live || row.current_video_uid !== uid) {
            await supabaseServer
              .from('live_streams')
              .update({
                is_live: true,
                current_video_uid: uid,
                started_at: (row.is_live || resumed) && row.started_at ? row.started_at : video?.created ?? nowIso,
                ended_at: null,
                checked_at: nowIso,
                ...confirmedNow,
                updated_at: nowIso,
              })
              .eq('owner_id', row.owner_id);
            if (uid) await notifyGoingLive(row, uid);
          } else {
            await supabaseServer.from('live_streams').update({ checked_at: nowIso, ...confirmedNow }).eq('owner_id', row.owner_id);
          }
        } else if (decision === 'keep') {
          // Appka hlásí, že vysílá (Cloudflare to jen ještě nepotvrdil), nebo se vstup právě
          // připojuje znovu. checked_at se tu nemění: drží čas posledního potvrzení od Cloudflare.
          if (!video && row.current_video_uid) {
            // Přenos, který Cloudflare před chvílí potvrdil, teď nevidí - do deníku (proč pak zmizel / nezmizel).
            logLiveEvent(row.owner_id, 'unseen', 'Cloudflare přenos teď nevidí - zatím se drží (appka hlásí / krátký výpadek)', {
              'lifecycle (přijímá vysílání)': life ? life.live : 'nejde zjistit',
              'v seznamu běžících': false,
              'appka hlásila (s)': secondsSince(row.app_ping_at),
              'appce se věří': appSignalTrusted(row),
              'Cloudflare naposledy potvrdil (s)': secondsSince(lastConfirmedIso(row)),
            });
            await supabaseServer.from('live_streams').update({ current_video_uid: null }).eq('owner_id', row.owner_id);
          }
        } else if (decision === 'end') {
          logLiveEvent(row.owner_id, 'end', 'ukončeno - Cloudflare přenos nevidí', {
            'lifecycle (přijímá vysílání)': life ? life.live : 'nejde zjistit',
            'v seznamu běžících': !!video,
            'appka hlásila (s)': secondsSince(row.app_ping_at),
            'appce se věří': appSignalTrusted(row),
            'Cloudflare naposledy potvrdil (s)': secondsSince(lastConfirmedIso(row)),
            'začátek (s)': secondsSince(row.started_at),
          });
          await endStream(row, nowIso);
        }
      }
    } catch (e) {
      // Cloudflare nebo databáze zrovna nejde - zkusí se to při dalším dotazu.
      console.error('Kine: stav živých vysílání se nepodařilo srovnat', (e as Error).message);
    }
  })();
  try {
    await syncing;
  } finally {
    syncing = null;
  }
}

/** Nejdéle tolik čeká odpověď divákovi na srovnání s Cloudflare; zbytek doběhne na pozadí. */
export const VIEWER_SYNC_BUDGET_MS = 1200;

/**
 * Srovnání s Cloudflare pro odpovědi divákům (řada Živě, stránka přenosu):
 * nejvýš VIEWER_SYNC_BUDGET_MS čekání. Dotazy na Cloudflare (seznam běžících,
 * lifecycle vstupů) trvaly někdy i několik vteřin - a celou tu dobu se
 * divákovi nic neukázalo (na hlavní stránce řada Živě chyběla, než
 * odpověď přišla). Stav v databázi drží čerstvý hlavně appka (hlásí se
 * každých 15 s a srovnání spouští sama); srovnání, které se do limitu
 * nevejde, doběhne na pozadí a projeví se při dalším obnovení (do 20 s).
 */
export async function syncLiveStreamsForViewers(budgetMs: number = VIEWER_SYNC_BUDGET_MS): Promise<void> {
  const run = syncLiveStreams();
  runInBackground(run, 'srovnání živých vysílání');
  let timer: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([run, new Promise<void>((resolve) => (timer = setTimeout(resolve, budgetMs)))]);
  if (timer) clearTimeout(timer);
}

/**
 * Kolik lidí přenos právě sleduje (Cloudflare: GET customer-<kód>.cloudflarestream.com/<vstup>/views).
 * Null, když to nejde zjistit - nikdy nečeká déle než 2 s.
 */
export async function liveViewerCount(inputId: string): Promise<number | null> {
  const code = await streamCustomerCode();
  if (!code || !/^[a-z0-9]+$/i.test(inputId)) return null;
  try {
    const res = await fetch(`https://customer-${code}.cloudflarestream.com/${inputId}/views`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const n = body?.liveViewers;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
}

function isMissingPingColumn(error: { message?: string; code?: string } | null): boolean {
  return !!error && (error.code === '42703' || /app_ping_at/i.test(error.message ?? ''));
}

/**
 * Hlášení z appky: "začal jsem vysílat" / "pořád vysílám" / "skončil jsem".
 * Vysílání se podle toho ukáže jako živé hned (Cloudflare ho potvrdí až za
 * pár vteřin, někdy déle) a `confirmed` řekne appce, jestli ho Cloudflare
 * opravdu vidí; `viewers` kolik lidí se dívá. Vrací null, když kanál nemá
 * založený klíč.
 *
 * Pojistky proti "falešnému živě": oznámení odběratelům jde až po potvrzení
 * od Cloudflare (syncLiveStreams), samotné "pořád vysílám" neoživí ukončený
 * přenos a přenos, který Cloudflare neviděl APP_UNCONFIRMED_MAX_MS, se ukončí.
 */
export async function appLiveSignal(
  ownerId: string,
  action: 'started' | 'ping' | 'stopped'
): Promise<{
  confirmed: boolean;
  migrated: boolean;
  viewers: number | null;
  /** Po "skončil jsem": záznam zveřejněný automaticky (nastavení tvůrce), jinak null. */
  recording?: { videoId: string; status: 'ready' | 'processing' } | null;
  /**
   * Po "skončil jsem": id záznamu PRÁVĚ skončeného vysílání u Cloudflare - appka ho
   * drží na kartě, ať "Stáhnout" a "Zahodit" míří na něj, ne na "nejnovější" (mezitím
   * mohlo začít jiné vysílání třeba z OBS).
   */
  recordingUid?: string | null;
  /** Přenos běží, ale kontrola obsahu ho skryla z "Živě" (čeká na moderátora) - appka to má říct, ne hlásit "vše v pořádku". */
  hidden?: boolean;
} | null> {
  const { data } = await supabaseServer.from('live_streams').select('*').eq('owner_id', ownerId).maybeSingle();
  if (!data) return null;
  const row = data as LiveStreamRow;
  const nowIso = new Date().toISOString();
  // Bez migrace (sloupec app_ping_at chybí) funguje všechno postaru - stav jen podle Cloudflare.
  let migrated = Object.prototype.hasOwnProperty.call(row, 'app_ping_at');

  async function write(patch: Record<string, unknown>): Promise<void> {
    const first = await supabaseServer.from('live_streams').update(patch).eq('owner_id', ownerId);
    if (isMissingPingColumn(first.error)) {
      // Migrace ještě není pustěná: stav se dá uložit i bez hlášení (jen ho pak srovná Cloudflare sám).
      migrated = false;
      const { app_ping_at: _drop, ...rest } = patch;
      await supabaseServer.from('live_streams').update(rest).eq('owner_id', ownerId);
    }
  }

  const stopPatch = {
    app_ping_at: null,
    is_live: false,
    current_video_uid: null,
    checked_at: nowIso,
    updated_at: nowIso,
  };

  if (action === 'stopped') {
    if (row.is_live) logLiveEvent(ownerId, 'stop', 'ukončeno v appce (Ukončit)', { 'začátek (s)': secondsSince(row.started_at) });
    // Který záznam patří k tomuhle vysílání: video, které Cloudflare právě nahrával; když ho
    // Kine už nemá (přenos skončil dřív), nejnovější záznam od začátku vysílání.
    let recordingUid: string | null = row.current_video_uid ?? null;
    if (!recordingUid && row.cf_input_id && row.started_at) {
      try {
        const since = Date.parse(row.started_at) - 2 * 60 * 1000;
        const recs = await listInputVideos(row.cf_input_id);
        recordingUid = recs.find((r) => r.created && Date.parse(r.created) >= since)?.uid ?? null;
      } catch {
        recordingUid = null;
      }
    }
    await write({ ...stopPatch, ended_at: row.is_live ? nowIso : row.ended_at });
    if (row.is_live) await addLiveSeconds(row, nowIso);
    // Záznam rovnou na Kine, když si to tvůrce zapnul (studio / appka).
    const published = row.is_live ? await autoPublishAfterStream(ownerId) : null;
    return { confirmed: false, migrated, viewers: null, recording: published?.ok ? { videoId: published.videoId, status: published.status } : null, recordingUid };
  }

  const wasLive = row.is_live;
  // Ukončený přenos (appkou nebo pro dlouhé nepotvrzení) oživí jen "začal jsem", ne "pořád vysílám".
  const revive = action === 'started' || wasLive || !!row.app_ping_at;
  if (action === 'started') {
    logLiveEvent(ownerId, 'start', wasLive ? 'appka začala vysílat (přenos už byl živě)' : 'appka začala vysílat', {
      'konec minulého (s)': secondsSince(row.ended_at),
      'databáze má sloupec app_ping_at': migrated,
    });
  }
  if (revive) {
    await write({
      app_ping_at: nowIso,
      is_live: true,
      ended_at: null,
      // Nepotvrzený přenos z poslední čtvrthodiny si nechá původní začátek (lib/liveSignal.ts).
      started_at: wasLive && row.started_at ? row.started_at : revivedStartedAt(row),
      ...(wasLive ? {} : { current_video_uid: null }),
      updated_at: nowIso,
    });
  }

  // Srovnat s Cloudflare (nejvýš jednou za pár vteřin) a říct appce, jestli proud vidí.
  await syncLiveStreams();
  const { data: afterData } = await supabaseServer.from('live_streams').select('*').eq('owner_id', ownerId).maybeSingle();
  const after = afterData as LiveStreamRow | null;
  const confirmed = !!after?.is_live && !!after?.current_video_uid;

  if (migrated && after?.is_live && !confirmed && !appSignalTrusted(after)) {
    // Cloudflare přenos dlouho nevidí (špatný klíč, nic se neposílá...) - z "Živě" pryč.
    logLiveEvent(ownerId, 'unconfirmed', 'ukončeno - appka hlásí vysílání, ale Cloudflare ho minuty nevidí (špatný klíč? nic nejde ven?)', {
      'začátek (s)': secondsSince(after.started_at),
      'Cloudflare naposledy potvrdil (s)': secondsSince(lastConfirmedIso(after)),
      'vstup Cloudflare': after.cf_input_id,
    });
    await write({ ...stopPatch, ended_at: nowIso });
    return { confirmed: false, migrated, viewers: null };
  }

  const viewers = confirmed && after ? await liveViewerCount(after.cf_input_id) : null;
  return { confirmed, migrated, viewers, hidden: !!after?.is_live && liveHiddenNow(after as any) };
}

/**
 * Odběratelé (se zapnutým zvonečkem) dostanou "X je živě". Jednou za přenos
 * a nejvýš jednou za půl hodiny - o to se postará podmíněný zápis: kdo ho
 * udělá první, ten oznámení pošle, souběžný dotaz už ne.
 */
async function notifyGoingLive(row: LiveStreamRow, videoUid: string): Promise<void> {
  if (row.notified_video_uid === videoUid) return;
  if (row.notified_at && Date.now() - new Date(row.notified_at).getTime() < RENOTIFY_AFTER_MS) {
    await supabaseServer.from('live_streams').update({ notified_video_uid: videoUid }).eq('owner_id', row.owner_id);
    return;
  }
  const claim = await supabaseServer
    .from('live_streams')
    .update({ notified_video_uid: videoUid, notified_at: new Date().toISOString() })
    .eq('owner_id', row.owner_id)
    .or(`notified_video_uid.is.null,notified_video_uid.neq.${videoUid}`)
    .select('owner_id');
  if (claim.error || !claim.data || claim.data.length === 0) return;

  const [{ data: subs }, { data: profile }] = await Promise.all([
    supabaseServer.from('subscriptions').select('subscriber_id').eq('channel_id', row.owner_id).eq('notify_new_videos', true),
    supabaseServer.from('profiles').select('username, display_name, is_banned, is_shadow_banned').eq('id', row.owner_id).maybeSingle(),
  ]);
  if (!subs || subs.length === 0) return;
  // Zablokovaný nebo shadow-banovaný kanál odběratelům nic nehlásí (klíč pro OBS mu dál funguje).
  if (profile?.is_banned || profile?.is_shadow_banned) return;
  const name = profile?.display_name || profile?.username || 'Kanál';
  const title = row.title?.trim();
  await supabaseServer.from('notifications').insert(
    subs.map((s: any) => ({
      user_id: s.subscriber_id,
      type: 'live',
      message: title ? `🔴 ${name} je živě: ${title}` : `🔴 ${name} je živě`,
      link: `/live/${row.owner_id}`,
    }))
  );
}

/** Veřejné údaje o přenosu pro stránky (bez klíče). */
export type PublicLive = {
  ownerId: string;
  live: boolean;
  title: string;
  description: string;
  category: string | null;
  startedAt: string | null;
  endedAt: string | null;
  inputId: string;
  videoUid: string | null;
  playerUrl: string;
  /** Od kdy ukazovat chat - každé vysílání má svůj (lib/liveChat.ts). */
  chatSince: string | null;
  /** Vlastní náhled přenosu; null = snímek z vysílání od Cloudflare. */
  thumbnailUrl: string | null;
};

export async function publicLive(row: LiveStreamRow): Promise<PublicLive> {
  const code = await streamCustomerCode();
  return {
    chatSince: chatSessionSince({ live: row.is_live, startedAt: row.started_at, endedAt: row.ended_at }),
    thumbnailUrl: typeof row.thumbnail_url === 'string' && /^https:\/\//.test(row.thumbnail_url) ? row.thumbnail_url : null,
    ownerId: row.owner_id,
    live: row.is_live,
    title: row.title,
    description: row.description,
    category: row.category,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    inputId: row.cf_input_id,
    videoUid: row.current_video_uid,
    playerUrl: livePlayerUrl(row.cf_input_id, row.current_video_uid, code),
  };
}
