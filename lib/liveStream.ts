import { supabaseServer } from './supabaseServer';

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

/**
 * Srovná stav živých vysílání s Cloudflare. Nikdy nehodí chybu (volá se
 * z odpovědí divákům); nejvýš jednou za SYNC_THROTTLE_MS, souběžná volání
 * počkají na jedno.
 */
export async function syncLiveStreams(options: { force?: boolean } = {}): Promise<void> {
  if (!cloudflare()) return;
  const now = Date.now();
  if (!options.force && now - lastSyncAt < SYNC_THROTTLE_MS) return;
  if (syncing) return syncing;
  lastSyncAt = now;
  syncing = (async () => {
    try {
      // Všechno, co u Cloudflare právě běží živě (jedním dotazem pro celý účet).
      const result = await cfFetch('?status=live-inprogress&asc=false');
      const running: any[] = (Array.isArray(result) ? result : []).filter(
        (v) => String(v.status?.state ?? v.state ?? '') === 'live-inprogress' && v.liveInput
      );
      for (const v of running) {
        const code = codeFromUrl(v.playback?.hls) ?? codeFromUrl(v.thumbnail);
        if (code) customerCode = code;
      }
      const liveInputs = new Map<string, any>();
      for (const v of running) if (!liveInputs.has(v.liveInput)) liveInputs.set(v.liveInput, v);

      const { data: rows } = await supabaseServer
        .from('live_streams')
        .select('*')
        .or(`is_live.eq.true${liveInputs.size > 0 ? `,cf_input_id.in.(${[...liveInputs.keys()].map((id) => `"${id}"`).join(',')})` : ''}`);

      const nowIso = new Date().toISOString();
      for (const row of (rows ?? []) as LiveStreamRow[]) {
        const video = liveInputs.get(row.cf_input_id);
        if (video) {
          const uid = String(video.uid);
          if (!row.is_live || row.current_video_uid !== uid) {
            await supabaseServer
              .from('live_streams')
              .update({
                is_live: true,
                current_video_uid: uid,
                started_at: row.is_live && row.started_at ? row.started_at : video.created ?? nowIso,
                ended_at: null,
                checked_at: nowIso,
                updated_at: nowIso,
              })
              .eq('owner_id', row.owner_id);
            await notifyGoingLive(row, uid);
          } else {
            await supabaseServer.from('live_streams').update({ checked_at: nowIso }).eq('owner_id', row.owner_id);
          }
        } else if (row.is_live) {
          await supabaseServer
            .from('live_streams')
            .update({ is_live: false, ended_at: nowIso, checked_at: nowIso, updated_at: nowIso })
            .eq('owner_id', row.owner_id);
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
    supabaseServer.from('profiles').select('username, display_name').eq('id', row.owner_id).maybeSingle(),
  ]);
  if (!subs || subs.length === 0) return;
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
};

export async function publicLive(row: LiveStreamRow): Promise<PublicLive> {
  const code = await streamCustomerCode();
  return {
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
