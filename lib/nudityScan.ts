import { supabaseServer } from './supabaseServer';
import { liveThumbnailPath } from './liveThumbnail';
import { SERVER_FETCH_TOKEN_TTL_S, createStreamToken, signingKeyFromEnv } from './streamToken';
import { syncVideoProtection } from './streamProtection';
import {
  addLiveStrike,
  framesFromPredictions,
  liveHiddenNow,
  liveShouldHide,
  liveSnapshotLevel,
  liveStrikesSince,
  nudityVerdict,
  pornScore,
  scanTimes,
  type FrameScores,
  type NudityVerdict,
} from './nudityRules';

/**
 * Automatická kontrola nahoty a porna (pravidla v lib/nudityRules.ts).
 *
 * Model nsfwjs (MobileNetV2, ~3,5 MB) běží přímo na serveru v čistém
 * JavaScriptu (TensorFlow.js, procesor) - žádná placená služba, žádný
 * klíč, obrázky nikam neodcházejí. Jeden snímek trvá zhruba 1,5 s,
 * video se kontroluje 4-6 snímky z Cloudflare (náhledy v daném čase).
 *
 * Kdy se kontroluje:
 *   - video po zpracování (markVideoReady, na pozadí - oznámení
 *     odběratelům jde až po kontrole, skryté video se nehlásí),
 *   - starší a nezkontrolovaná videa po troškách (sweepNudity: úklid
 *     při provozu a denní cron),
 *   - živé přenosy: snímek každé ~2 minuty (scanLiveStreams).
 *
 * Bez migrace supabase-migration-podpory-kontrola.sql (chybí sloupce
 * moderation_*) se nic nekontroluje a nic se neskrývá.
 */

type Model = { classify: (img: unknown) => Promise<{ className: string; probability: number }[]> };
type Tf = typeof import('@tensorflow/tfjs');

let loading: Promise<{ tf: Tf; model: Model }> | null = null;

/** Model se načte jednou na instanci serveru (~1-2 s) a pak se drží. */
function loadModel(): Promise<{ tf: Tf; model: Model }> {
  loading ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    await tf.setBackend('cpu');
    await tf.ready();
    const { load } = await import('nsfwjs/core');
    const { MobileNetV2Model } = await import('nsfwjs/models/mobilenet_v2');
    const model = (await load('MobileNetV2', { modelDefinitions: [MobileNetV2Model] })) as unknown as Model;
    return { tf, model };
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/** Stáhne obrázek (JPEG) a ohodnotí ho. null = nejde stáhnout / není to JPEG. */
async function classifyUrl(url: string): Promise<FrameScores | null> {
  let bytes: Uint8Array;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const { tf, model } = await loadModel();
  const jpeg = (await import('jpeg-js')).default;
  let decoded: { width: number; height: number; data: Uint8Array };
  try {
    decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 }) as any;
  } catch {
    return null;
  }
  const image = tf.tensor3d(decoded.data, [decoded.height, decoded.width, 3], 'int32');
  try {
    return framesFromPredictions(await model.classify(image));
  } finally {
    image.dispose();
  }
}

/** Id videa do adresy náhledu: s podpisovým klíčem token (projde i u chráněného videa). */
export function frameId(cloudflareVideoId: string, ttlSeconds = SERVER_FETCH_TOKEN_TTL_S): string {
  const key = signingKeyFromEnv();
  return key ? createStreamToken(key, cloudflareVideoId, { ttlSeconds }) : cloudflareVideoId;
}

export function frameUrl(id: string, seconds: number | null, height = 224): string {
  const time = seconds === null ? '' : `time=${Math.max(0, Math.floor(seconds))}s&`;
  return `https://videodelivery.net/${encodeURIComponent(id)}/thumbnails/thumbnail.jpg?${time}height=${height}`;
}

/** Kontrola je zapnutá jen s migrací (sloupce moderation_* u videí). */
function moderationReady(row: Record<string, unknown> | null | undefined): boolean {
  return !!row && Object.prototype.hasOwnProperty.call(row, 'moderation_checked_at');
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ScanResult =
  | { outcome: 'checked'; verdict: NudityVerdict }
  | { outcome: 'missing' | 'unavailable' | 'not-ready' | 'failed' };

/**
 * Zkontroluje video a podle výsledku ho skryje (hold), pošle ke kontrole
 * (review), nebo jen zapíše, že je zkontrolované. Oznámení odběratelům
 * řeší volající (markVideoReady) - podle výsledku.
 */
export async function scanVideo(videoId: string): Promise<ScanResult> {
  const { data: video } = await supabaseServer.from('videos').select('*').eq('id', videoId).maybeSingle();
  if (!video) return { outcome: 'missing' };
  if (!moderationReady(video)) return { outcome: 'unavailable' };
  if (video.status !== 'ready' || !video.cloudflare_video_id) return { outcome: 'not-ready' };

  const times = scanTimes(Number(video.duration_seconds) || 0);
  const id = frameId(video.cloudflare_video_id);
  const targets: { t: number | null; url: string }[] = times.map((t) => ({ t, url: frameUrl(id, t) }));
  // Vlastní náhled (ten se ukazuje na kartách) taky.
  if (video.custom_thumbnail && typeof video.thumbnail_url === 'string' && /^https:\/\//.test(video.thumbnail_url)) {
    targets.push({ t: null, url: video.thumbnail_url });
  }

  const scored: { t: number | null; f: FrameScores }[] = [];
  for (const target of targets) {
    const f = await classifyUrl(target.url).catch(() => null);
    if (f) scored.push({ t: target.t, f });
  }
  if (scored.length === 0) return { outcome: 'failed' };

  let verdict = nudityVerdict(scored.map((s) => s.f), { artistic: !!video.artistic });
  // Moderátor už video jednou pustil (a teď se kontroluje znovu - třeba kvůli novému
  // náhledu): neskrývat znovu automaticky, jen poslat ke kontrole.
  if (verdict.action === 'hold') {
    const approved = await supabaseServer.from('content_flags').select('id').eq('video_id', videoId).eq('status', 'approved').limit(1);
    if (!approved.error && (approved.data ?? []).length > 0) verdict = { ...verdict, action: 'review' };
  }
  const nowIso = new Date().toISOString();
  const scores = scored.map(({ t, f }) => ({ t, porn: round2(pornScore(f)), sexy: round2(f.sexy) }));

  if (verdict.action === 'ok') {
    await supabaseServer.from('videos').update({ moderation_checked_at: nowIso }).eq('id', videoId);
    return { outcome: 'checked', verdict };
  }

  if (verdict.action === 'hold') {
    // Už skryté (opakovaná kontrola) - původní viditelnost zůstane ta první.
    const alreadyHeld = !!video.moderation_hold;
    const { error } = await supabaseServer
      .from('videos')
      .update({
        moderation_checked_at: nowIso,
        moderation_reason: verdict.reason,
        moderation_hold: alreadyHeld ? video.moderation_hold : 'hidden',
        moderation_prev_visibility: alreadyHeld ? video.moderation_prev_visibility : video.visibility,
        visibility: 'private',
      })
      .eq('id', videoId);
    if (error) {
      console.error('Kine: kontrola obsahu - skrytí videa', error.message);
      return { outcome: 'failed' };
    }
    if (video.visibility !== 'private') await syncVideoProtection(videoId).catch(() => undefined);
  } else {
    await supabaseServer.from('videos').update({ moderation_checked_at: nowIso, moderation_reason: verdict.reason }).eq('id', videoId);
  }

  await openFlag({
    kind: 'video',
    video_id: videoId,
    channel_id: video.owner_id,
    verdict: verdict.action === 'hold' ? 'hidden' : 'review',
    reason: verdict.reason ?? 'nudity',
    scores,
    artistic: !!video.artistic,
  });

  if (verdict.action === 'hold' && !video.moderation_hold) {
    await supabaseServer.from('notifications').insert({
      user_id: video.owner_id,
      type: 'moderation_warning',
      message: `⚠️ Video „${String(video.title ?? '').slice(0, 80)}“ je dočasně skryté - automatická kontrola v něm našla možnou nahotu. Moderátor ho zkontroluje (umělecká díla povolujeme). Do té doby ho vidíš jen ty.`,
      link: `/watch/${videoId}`,
    });
  }
  return { outcome: 'checked', verdict };
}

type FlagInput = {
  kind: 'video' | 'live';
  video_id?: string | null;
  channel_id: string;
  live_video_uid?: string | null;
  verdict: 'hidden' | 'review';
  reason: string;
  scores: unknown[];
  artistic?: boolean;
};

/** Položka ve frontě moderátorů - u videa nejvýš jedna otevřená (nová přepíše starou). */
async function openFlag(input: FlagInput): Promise<void> {
  if (input.kind === 'video' && input.video_id) {
    const existing = await supabaseServer.from('content_flags').select('id').eq('video_id', input.video_id).eq('status', 'open').limit(1);
    const id = existing.data?.[0]?.id;
    if (id) {
      await supabaseServer.from('content_flags').update({ verdict: input.verdict, reason: input.reason, scores: input.scores, artistic: !!input.artistic }).eq('id', id);
      return;
    }
  }
  const { error } = await supabaseServer.from('content_flags').insert({ ...input, artistic: !!input.artistic });
  if (error) console.error('Kine: kontrola obsahu - fronta', error.message);
}

/**
 * Nezkontrolovaná videa (nahraná před zapnutím kontroly, nebo když kontrola
 * po zpracování nevyšla) - pár naráz, nejnovější první. Volá se na pozadí
 * z úklidu (sweepProcessing) a z denního cronu.
 */
let lastSweepAt = 0;
export async function sweepNudity(options: { max?: number; force?: boolean; budgetMs?: number } = {}): Promise<number> {
  const now = Date.now();
  if (!options.force && now - lastSweepAt < 5 * 60 * 1000) return 0;
  lastSweepAt = now;
  const max = Math.max(1, Math.min(options.max ?? 2, 40));
  const deadline = now + (options.budgetMs ?? 60_000);
  const { data, error } = await supabaseServer
    .from('videos')
    .select('id')
    .eq('status', 'ready')
    .is('moderation_checked_at', null)
    .order('created_at', { ascending: false })
    .limit(max);
  if (error || !data) return 0;
  let checked = 0;
  for (const row of data) {
    if (Date.now() > deadline) break;
    try {
      const result = await scanVideo(row.id);
      if (result.outcome === 'checked') checked += 1;
    } catch {
      // Jedno video nevyšlo - zkusí se příště.
    }
  }
  return checked;
}

// ---- živé vysílání ----------------------------------------------------------------

/** Jak často se bere snímek z jednoho přenosu. */
export const LIVE_SNAPSHOT_EVERY_MS = 2 * 60 * 1000;
let lastLiveScanAt = 0;

/**
 * Snímek z každého živého přenosu nejvýš jednou za ~2 minuty (víc instancí
 * serveru se nepoperou - kdo zapíše čas kontroly, ten kontroluje). Přenos,
 * kde model opakovaně vidí nahotu nebo porno, zmizí z hlavní stránky
 * i ze stránky Živě a divákům se místo něj ukáže "čeká na kontrolu";
 * moderátor ho pak pustí, nebo nechá skrytý.
 */
export async function scanLiveStreams(): Promise<void> {
  const now = Date.now();
  if (now - lastLiveScanAt < 45 * 1000) return;
  lastLiveScanAt = now;
  const { data, error } = await supabaseServer.from('live_streams').select('*').eq('is_live', true).limit(40);
  if (error || !data) return;
  const cutoff = new Date(now - LIVE_SNAPSHOT_EVERY_MS).toISOString();
  const due = (data as Record<string, any>[]).filter(
    (r) =>
      moderationReady(r) &&
      r.current_video_uid &&
      r.moderation_cleared_uid !== r.current_video_uid &&
      (!r.moderation_checked_at || r.moderation_checked_at < cutoff)
  );
  for (const row of due.slice(0, 4)) {
    const claim = await supabaseServer
      .from('live_streams')
      .update({ moderation_checked_at: new Date().toISOString() })
      .eq('owner_id', row.owner_id)
      .or(`moderation_checked_at.is.null,moderation_checked_at.lt.${cutoff}`)
      .select('owner_id');
    if (claim.error || !claim.data || claim.data.length === 0) continue;

    const f = await classifyUrl(`${frameUrl(row.current_video_uid, null)}&t=${Date.now()}`).catch(() => null);
    if (!f) continue;
    const level = liveSnapshotLevel(f);
    const at = Date.now();
    // Skrytí i podezřelé snímky platí jen pro tenhle přenos (lib/nudityRules.ts - liveHiddenNow):
    // pozdější přenos začíná načisto a staré skrytí se z řádku smaže.
    const hiddenNow = liveHiddenNow(row);
    const strikes = addLiveStrike(liveStrikesSince(row.moderation_strikes, row.started_at), level, at);
    const hide = !hiddenNow && liveShouldHide(strikes, at);
    const hiddenPatch = hide
      ? { moderation_hidden_at: new Date(at).toISOString() }
      : !hiddenNow && row.moderation_hidden_at
        ? { moderation_hidden_at: null }
        : {};
    await supabaseServer
      .from('live_streams')
      .update({ moderation_strikes: strikes, ...hiddenPatch })
      .eq('owner_id', row.owner_id);
    if (!hide) continue;
    await openFlag({
      kind: 'live',
      channel_id: row.owner_id,
      live_video_uid: row.current_video_uid,
      verdict: 'hidden',
      reason: pornScore(f) >= f.sexy ? 'porn' : 'nudity',
      scores: strikes.map((s) => ({ at: s.at, level: s.level })),
    });
    await supabaseServer.from('notifications').insert({
      user_id: row.owner_id,
      type: 'moderation_warning',
      message:
        '⚠️ Tvůj přenos je dočasně skrytý z hlavní stránky i ze stránky Živě - automatická kontrola v obrazu opakovaně našla možnou nahotu. Moderátor ho zkontroluje. Skrytí platí pro tenhle přenos; přenos spuštěný aspoň půl hodiny po skrytí začne normálně.',
      link: `/live/${row.owner_id}`,
    });
    await notifyStaffAboutHiddenLive(row.owner_id);
  }
}

/**
 * Tým Kine (moderátoři, správci i správce webu - is_admin) se o skrytém
 * přenosu dozví hned - přenos běží teď a omyl (hra, kůže zblízka) se má
 * pustit, dokud vysílání trvá. Odkaz vede na přenos (tým ho vidí i skrytý),
 * pustit ho jde v Hlášeních jedním kliknutím.
 */
async function notifyStaffAboutHiddenLive(ownerId: string): Promise<void> {
  try {
    const staffQuery = await supabaseServer.from('profiles').select('id').or('role.in.(moderator,admin),is_admin.eq.true');
    const staff = staffQuery.error
      ? (await supabaseServer.from('profiles').select('id').in('role', ['moderator', 'admin'])).data
      : staffQuery.data;
    const recipients = (staff ?? []).filter((s: { id: string }) => s.id !== ownerId);
    if (recipients.length === 0) return;
    const { data: owner } = await supabaseServer.from('profiles').select('username').eq('id', ownerId).maybeSingle();
    const name = owner?.username ? `@${owner.username}` : 'kanálu';
    // Bez "type": povolené druhy oznámení hlídá databáze a tenhle mezi nimi není (stejně jako u autorských práv).
    await supabaseServer.from('notifications').insert(
      recipients.map((s: { id: string }) => ({
        user_id: s.id,
        message: `⚠️ Přenos ${name} je automaticky skrytý (možná nahota) - podívej se na něj; pustit ho jde v Nahlášeních.`,
        link: `/live/${ownerId}`,
      }))
    );
  } catch {
    // Oznámení navíc - kontrola se kvůli němu nesmí rozbít.
  }
}

/**
 * Vlastní náhled přenosu (app/api/live/thumbnail): když v něm kontrola
 * najde nahotu nebo porno, náhled se nepoužije - v řadě "Živě" zůstane
 * snímek z vysílání - a tvůrce dostane oznámení. Mezitím nahraný jiný
 * náhled se nemaže.
 */
export async function scanLiveThumbnail(ownerId: string, url: string): Promise<'ok' | 'removed' | 'failed'> {
  // Čerstvě nahraný obrázek: když ho úložiště ještě nevydá, zkusí se to znovu
  // (dekodér ho přečte - route app/api/live/thumbnail to ověřila předem).
  let f: FrameScores | null = null;
  for (let attempt = 0; attempt < 3 && !f; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 3000));
    f = await classifyUrl(url).catch(() => null);
  }
  if (!f) {
    console.error('Kine: náhled přenosu se nepodařilo zkontrolovat', ownerId);
    return 'failed';
  }
  if (nudityVerdict([f]).action !== 'hold') return 'ok';
  // Soubor pryč i z úložiště - jinak by byl dál k vidění přes svou adresu.
  const path = liveThumbnailPath(url, ownerId);
  if (path) await supabaseServer.storage.from('thumbnails').remove([path]).then(() => undefined, () => undefined);
  const { data } = await supabaseServer
    .from('live_streams')
    .update({ thumbnail_url: null })
    .eq('owner_id', ownerId)
    .eq('thumbnail_url', url)
    .select('owner_id');
  if (data && data.length > 0) {
    await supabaseServer.from('notifications').insert({
      user_id: ownerId,
      type: 'moderation_warning',
      message: '⚠️ Náhled přenosu se nepoužije - automatická kontrola v něm našla možnou nahotu. V řadě Živě se místo něj ukazuje snímek z vysílání; můžeš nahrát jiný.',
      link: '/live',
    });
  }
  return 'removed';
}
