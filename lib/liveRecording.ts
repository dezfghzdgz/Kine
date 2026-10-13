import { supabaseServer } from './supabaseServer';
import { cloudflareVideo, deleteCloudflareVideo, keepRecording, listInputVideos, requestCloudflareDownload, type LiveRecording } from './liveStream';
import { refreshFromCloudflare } from './markVideoReady';
import { protectionConfigured, shouldBeProtected, syncVideoProtection } from './streamProtection';
import { createStreamToken, DOWNLOAD_TOKEN_TTL_S, signingKeyFromEnv, swapPlaybackId } from './streamToken';
import { channelRoom } from './liveChat';
import { defaultRecordingTitle, parseRecordingVisibility, pickRecording, recordingsInWindow, type RecordingVisibility } from './liveRecordingRules';

export { defaultRecordingTitle, parseRecordingVisibility, pickRecording, RECORDING_VISIBILITIES, type RecordingVisibility } from './liveRecordingRules';

/**
 * Záznam vysílání -> video na Kine.
 *
 * Cloudflare každé vysílání nahrává sám (záznam leží u vstupu, nezveřejněný
 * se po 30 dnech smaže). Odsud se z něj stane normální video: z tlačítka ve
 * studiu, z appky Kine po skončení vysílání, nebo samo (když si to tvůrce
 * zapnul - live_streams.recording_visibility). Na rozdíl od Twitche, kde
 * záznamy po 7-60 dnech mizí, zveřejněný záznam zůstává napořád.
 *
 * Záznam, který Cloudflare ještě uzavírá (po konci vysílání čeká minutu,
 * jestli se vysílání nepřipojí znovu), jde zveřejnit taky - video je pak
 * chvíli "zpracovává se" a hotové se přepne samo (webhook / úklid).
 */
export type PublishResult =
  | { ok: true; videoId: string; alreadyPublished: boolean; status: 'ready' | 'processing' }
  | { ok: false; status: number; error: string };

export async function publishRecording(
  ownerId: string,
  options: {
    videoUid?: string;
    title?: string;
    description?: string;
    visibility?: RecordingVisibility | null;
    language?: string;
    /** Zveřejnit hned po skončení vysílání: odběratelé už dostali "je živě", oznámení o novém videu se neposílá. */
    rightAfterStream?: boolean;
  }
): Promise<PublishResult> {
  const { data: input } = await supabaseServer.from('live_inputs').select('cf_input_id').eq('owner_id', ownerId).maybeSingle();
  if (!input?.cf_input_id) return { ok: false, status: 404, error: 'Nemáš založené živé vysílání.' };

  let recordings: LiveRecording[];
  try {
    recordings = await listInputVideos(input.cf_input_id);
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message };
  }

  const uids = recordings.map((r) => r.uid);
  const publishedIds = new Map<string, string>();
  if (uids.length > 0) {
    const { data } = await supabaseServer.from('videos').select('id, cloudflare_video_id').eq('owner_id', ownerId).in('cloudflare_video_id', uids);
    for (const v of data ?? []) publishedIds.set(v.cloudflare_video_id as string, v.id as string);
  }

  const wanted = String(options.videoUid ?? 'latest');
  // Pro "latest" se nepřeskakují už zveřejněné: kdyby nejnovější záznam už byl venku,
  // vrátí se jeho video (appka tak ví, kam odkázat), ne starší záznam.
  const rec = wanted === 'latest' ? pickRecording(recordings, 'latest', new Set(), Date.now()) : pickRecording(recordings, wanted, new Set());
  if (!rec) return { ok: false, status: 404, error: wanted === 'latest' ? 'Záznam vysílání zatím není - zkus to za minutu.' : 'Záznam nenalezen.' };

  const existingId = publishedIds.get(rec.uid);
  if (existingId) return { ok: true, videoId: existingId, alreadyPublished: true, status: 'ready' };

  const { data: stream } = await supabaseServer.from('live_streams').select('*').eq('owner_id', ownerId).maybeSingle();
  // Běžící vysílání se zveřejnit nedá; po jeho konci ano, i když Cloudflare záznam ještě uzavírá.
  if (rec.state === 'live-inprogress' && stream?.is_live) return { ok: false, status: 409, error: 'Vysílání ještě běží.' };

  const title = (options.title ?? '').trim().slice(0, 150) || (stream?.title ?? '').trim().slice(0, 150) || defaultRecordingTitle(rec.created);
  const description = (options.description ?? stream?.description ?? '').trim().slice(0, 5000);
  const visibility = options.visibility ?? 'public';
  const info = await cloudflareVideo(rec.uid);
  const base = {
    owner_id: ownerId,
    title,
    description,
    cloudflare_video_id: rec.uid,
    status: 'processing',
    visibility,
    category: stream?.category ?? null,
    language: typeof options.language === 'string' && options.language ? options.language.slice(0, 5) : 'en',
    width: info?.input?.width ?? null,
    height: info?.input?.height ?? null,
    chapters: [],
    captions: [],
    hashtags: [],
  };
  // Novější sloupce (chat k záznamu, hlídání oznámení) - bez migrace se uloží i bez nich.
  const extra: Record<string, unknown> = {
    live_room: channelRoom(ownerId),
    live_started_at: rec.created ?? stream?.started_at ?? null,
    ...(options.rightAfterStream ? { subscribers_notified_at: new Date().toISOString() } : {}),
  };
  // Chybějící sloupec (starší databáze) vypadne sám - ostatní se uloží dál (záznam chatu nezávisí na hlídání oznámení).
  let payload: Record<string, unknown> = { ...base, ...extra };
  let inserted = await supabaseServer.from('videos').insert(payload).select('id').single();
  for (let attempt = 0; attempt < 3 && inserted.error; attempt++) {
    const message = inserted.error.message ?? '';
    const missing = Object.keys(extra).find((key) => key in payload && message.includes(key));
    if (!missing) break;
    const { [missing]: _dropped, ...rest } = payload;
    payload = rest;
    inserted = await supabaseServer.from('videos').insert(payload).select('id').single();
  }
  if (inserted.error || !inserted.data) {
    // Souběh (studio + appka naráz): jeden řádek na jedno video u Cloudflare (unikátní index) - vrátit ten existující.
    const again = await supabaseServer.from('videos').select('id').eq('owner_id', ownerId).eq('cloudflare_video_id', rec.uid).maybeSingle();
    if (again.data) return { ok: true, videoId: again.data.id as string, alreadyPublished: true, status: 'processing' };
    return { ok: false, status: 500, error: inserted.error?.message ?? 'Uložení se nepovedlo.' };
  }

  const videoId = inserted.data.id as string;
  await keepRecording(rec.uid);
  if (shouldBeProtected(visibility)) await syncVideoProtection(videoId).catch(() => undefined);
  // Hotový záznam se přepne na "ready" hned; uzavíraný až ho Cloudflare dokončí (webhook / úklid zaseklých videí).
  const status = await refreshFromCloudflare(videoId).catch(() => 'processing' as const);
  return { ok: true, videoId, alreadyPublished: false, status: status === 'ready' ? 'ready' : 'processing' };
}

/**
 * Vysílání skončilo: když si tvůrce zapnul automatické zveřejnění záznamu
 * (studio / appka), zveřejní se teď. Nikdy nehodí chybu - volá se ze
 * syncLiveStreams a z hlášení appky.
 */
export async function autoPublishAfterStream(ownerId: string): Promise<PublishResult | null> {
  try {
    const { data: stream, error } = await supabaseServer.from('live_streams').select('*').eq('owner_id', ownerId).maybeSingle();
    if (error || !stream) return null;
    const visibility = parseRecordingVisibility((stream as Record<string, unknown>).recording_visibility);
    if (!visibility) return null;
    const result = await publishRecording(ownerId, { videoUid: 'latest', visibility, rightAfterStream: true });
    if (!result.ok) console.error('Kine: automatické zveřejnění záznamu', ownerId, result.error);
    return result;
  } catch (e) {
    console.error('Kine: automatické zveřejnění záznamu', (e as Error).message);
    return null;
  }
}

/**
 * Záznam kanálu podle id ("latest" = nejnovější). Hledá se jen v záznamech
 * vlastního vstupu - cizí záznam tudy smazat ani stáhnout nejde.
 */
async function ownRecording(
  ownerId: string,
  wanted: string
): Promise<{ ok: true; rec: LiveRecording; videoId: string | null; streamLive: boolean; liveUid: string | null } | { ok: false; status: number; error: string }> {
  const { data: input } = await supabaseServer.from('live_inputs').select('cf_input_id').eq('owner_id', ownerId).maybeSingle();
  if (!input?.cf_input_id) return { ok: false, status: 404, error: 'Nemáš založené živé vysílání.' };
  let recordings: LiveRecording[];
  try {
    recordings = await listInputVideos(input.cf_input_id);
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message };
  }
  const rec = wanted && wanted !== 'latest' ? recordings.find((r) => r.uid === wanted) ?? null : recordings[0] ?? null;
  if (!rec) return { ok: false, status: 404, error: wanted === 'latest' ? 'Záznam vysílání zatím není - zkus to za minutu.' : 'Záznam nenalezen.' };
  const [{ data: video }, { data: stream }] = await Promise.all([
    supabaseServer.from('videos').select('id').eq('owner_id', ownerId).eq('cloudflare_video_id', rec.uid).maybeSingle(),
    supabaseServer.from('live_streams').select('is_live, current_video_uid').eq('owner_id', ownerId).maybeSingle(),
  ]);
  return {
    ok: true,
    rec,
    videoId: (video?.id as string | undefined) ?? null,
    streamLive: !!stream?.is_live,
    liveUid: stream?.is_live ? ((stream.current_video_uid as string | null) ?? null) : null,
  };
}

export type RecordingActionResult = { ok: true; uid: string; uids?: string[] } | { ok: false; status: number; error: string; retry?: boolean };

/**
 * Běží tenhle záznam ještě živě? Jen když vysílání opravdu běží a je to jeho
 * video (nebo se neví, které video běží). Po Ukončit v appce Cloudflare ještě
 * minutu i déle hlásí záznam jako "live-inprogress" - ten už zahodit jde.
 */
function stillOnAir(rec: LiveRecording, streamLive: boolean, liveUid: string | null): boolean {
  if (!streamLive || rec.state !== 'live-inprogress') return false;
  return !liveUid || liveUid === rec.uid;
}

/**
 * "Zahodit": záznam pryč hned (jinak ho Cloudflare smaže po 30 dnech sám).
 * Záznam, ze kterého už je video na Kine, se tudy nemaže - to se maže jako
 * každé jiné video (Tvoje videa).
 */
export async function discardRecording(ownerId: string, wanted: string): Promise<RecordingActionResult> {
  if (!wanted || wanted === 'latest') return { ok: false, status: 400, error: 'Chybí, který záznam zahodit.' };
  const found = await ownRecording(ownerId, wanted);
  if (!found.ok) return found;
  if (found.videoId) return { ok: false, status: 409, error: 'Záznam už je video na Kine - smaž ho v Tvoje videa.' };
  if (stillOnAir(found.rec, found.streamLive, found.liveUid)) return { ok: false, status: 409, error: 'Vysílání ještě běží.', retry: true };
  try {
    await deleteCloudflareVideo(found.rec.uid);
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message, retry: true };
  }
  return { ok: true, uid: found.rec.uid, uids: [found.rec.uid] };
}

/**
 * "Zahodit" z appky, která nezná id záznamu (Cloudflare přenos za vysílání
 * nepotvrdil): smažou se záznamy vlastního vstupu vzniklé během vysílání
 * (lib/liveRecordingRules.ts, recordingsInWindow). Když tam ještě žádný není
 * (Cloudflare ho po konci chvíli zakládá), odpověď řekne "zkus znovu".
 */
export async function discardStreamRecordings(ownerId: string, window: { since: number; until: number }): Promise<RecordingActionResult> {
  const { data: input } = await supabaseServer.from('live_inputs').select('cf_input_id').eq('owner_id', ownerId).maybeSingle();
  if (!input?.cf_input_id) return { ok: false, status: 404, error: 'Nemáš založené živé vysílání.' };
  let recordings: LiveRecording[];
  try {
    recordings = await listInputVideos(input.cf_input_id);
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message, retry: true };
  }
  const uids = recordings.map((r) => r.uid);
  const [{ data: videos }, { data: stream }] = await Promise.all([
    uids.length > 0 ? supabaseServer.from('videos').select('cloudflare_video_id').eq('owner_id', ownerId).in('cloudflare_video_id', uids) : Promise.resolve({ data: [] as any[] }),
    supabaseServer.from('live_streams').select('is_live, current_video_uid').eq('owner_id', ownerId).maybeSingle(),
  ]);
  const published = new Set<string>(((videos ?? []) as any[]).map((v) => String(v.cloudflare_video_id)));
  const liveUid = stream?.is_live ? ((stream.current_video_uid as string | null) ?? null) : null;
  const candidates = recordingsInWindow(recordings, window, { published, keep: liveUid }).filter((r) => !stillOnAir(r, !!stream?.is_live, liveUid));
  if (candidates.length === 0) return { ok: false, status: 404, error: 'Záznam vysílání zatím není - zkouším to znovu.', retry: true };
  const deleted: string[] = [];
  let lastError: string | null = null;
  for (const rec of candidates) {
    try {
      await deleteCloudflareVideo(rec.uid);
      deleted.push(rec.uid);
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  if (deleted.length === 0) return { ok: false, status: 502, error: lastError ?? 'Cloudflare záznam nesmazal.', retry: true };
  return { ok: true, uid: deleted[0], uids: deleted };
}

export type DownloadResult =
  | { ok: true; uid: string; status: 'ready' | 'inprogress'; url: string | null; percent: number | null }
  | { ok: false; status: number; error: string };

/**
 * "Stáhnout do PC": adresa MP4 záznamu. Cloudflare ho nejdřív vyrobí (u
 * dlouhého vysílání pár minut) - volající se ptá znovu, dokud není "ready".
 * Záznam, který se ještě uzavírá (minuta po konci vysílání) nebo zpracovává,
 * je taky "chystá se"; běžící vysílání stáhnout nejde.
 */
export async function recordingDownload(ownerId: string, wanted: string): Promise<DownloadResult> {
  const found = await ownRecording(ownerId, wanted);
  if (!found.ok) return found;
  if (stillOnAir(found.rec, found.streamLive, found.liveUid)) return { ok: false, status: 409, error: 'Vysílání ještě běží.' };
  if (found.rec.state === 'error') return { ok: false, status: 502, error: 'Cloudflare záznam nezpracoval - stáhnout nejde.' };
  // Záznam se po konci vysílání ještě minutu uzavírá a pak zpracovává - "chystá se", zeptat se znovu.
  if (found.rec.state === 'live-inprogress' || !found.rec.readyToStream) return { ok: true, uid: found.rec.uid, status: 'inprogress', url: null, percent: null };
  try {
    const download = await requestCloudflareDownload(found.rec.uid);
    if (download.status === 'error') return { ok: false, status: 502, error: 'Cloudflare MP4 nevyrobil.' };
    let url = download.url;
    // Záznam zveřejněný jako soukromé video je chráněný - adresa potřebuje podpis (jako u stahování videa).
    if (url && found.videoId) url = await signedDownloadUrl(found.videoId, found.rec.uid, url);
    return { ok: true, uid: found.rec.uid, status: download.status, url: download.status === 'ready' ? url : null, percent: download.percent };
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message };
  }
}

async function signedDownloadUrl(videoId: string, uid: string, url: string): Promise<string> {
  const { data } = await supabaseServer.from('videos').select('visibility').eq('id', videoId).maybeSingle();
  const key = signingKeyFromEnv();
  if (!key || !protectionConfigured() || !shouldBeProtected((data?.visibility as string | undefined) ?? 'public')) return url;
  const token = createStreamToken(key, uid, { ttlSeconds: DOWNLOAD_TOKEN_TTL_S, downloadable: true });
  return swapPlaybackId(url, token) ?? url;
}
