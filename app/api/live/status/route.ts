import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, isStaffUser, userFromRequest } from '@/lib/apiUser';
import { publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';
import type { LiveRestriction } from '@/lib/liveNow';
import { liveHiddenNow } from '@/lib/nudityRules';
import { runInBackground } from '@/lib/background';
import { tipTarget } from '@/lib/liveTipsServer';
import { tipFeePercent } from '@/lib/liveTips';

export const dynamic = 'force-dynamic';
// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Přijímá kanál podpory? Stránka se ptá každých 6 s - odpověď si server minutu pamatuje. */
const tipsCache = new Map<string, { at: number; enabled: boolean }>();
async function tipsEnabled(channel: string): Promise<boolean> {
  const hit = tipsCache.get(channel);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.enabled;
  const enabled = (await tipTarget(channel).catch(() => ({ ok: false }))).ok;
  tipsCache.set(channel, { at: Date.now(), enabled });
  if (tipsCache.size > 2000) tipsCache.clear();
  return enabled;
}

/**
 * Záznam posledního vysílání kanálu (veřejné video vzniklé ze záznamu); bez
 * migrace zive-2 nic. Podle začátku vysílání, ne podle zveřejnění, a i když
 * se ještě zpracovává (hned po konci) - jinak by odkaz vedl na předchozí
 * vysílání. Minutu v paměti.
 */
const recordingCache = new Map<string, { at: number; value: { id: string; title: string; thumbnailUrl: string | null } | null }>();
async function latestRecording(channel: string): Promise<{ id: string; title: string; thumbnailUrl: string | null } | null> {
  const hit = recordingCache.get(channel);
  if (hit && Date.now() - hit.at < 60 * 1000) return hit.value;
  const { data, error } = await supabaseServer
    .from('videos')
    .select('id, title, thumbnail_url')
    .eq('owner_id', channel)
    .in('status', ['ready', 'processing'])
    .eq('visibility', 'public')
    .not('live_started_at', 'is', null)
    .order('live_started_at', { ascending: false })
    .limit(1);
  const row = !error && data && data[0] ? data[0] : null;
  const value = row ? { id: String(row.id), title: String(row.title ?? ''), thumbnailUrl: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null } : null;
  recordingCache.set(channel, { at: Date.now(), value });
  if (recordingCache.size > 2000) recordingCache.clear();
  return value;
}

/**
 * Je kanál živě? Stránka přenosu (/live/[id]) a odznak na kanálu se ptají
 * odsud. Stav se srovná s Cloudflare (nejvýš jednou za pár vteřin pro
 * všechny kanály naráz - lib/liveStream.ts).
 */
export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel') ?? '';
  if (!UUID.test(channel)) return NextResponse.json({ error: 'Neplatný kanál.' }, { status: 400 });

  await syncLiveStreams();
  const [{ data: row, error }, { data: profile }] = await Promise.all([
    supabaseServer.from('live_streams').select('*').eq('owner_id', channel).maybeSingle(),
    supabaseServer.from('profiles').select('id, username, display_name, avatar_url, verification_tier, is_banned, is_shadow_banned').eq('id', channel).maybeSingle(),
  ]);
  const { is_banned: banned, is_shadow_banned: shadowBanned, ...publicProfile } = (profile ?? {}) as Record<string, any>;
  if (isMissingTable(error)) return NextResponse.json({ enabled: false, live: false, profile: profile ? publicProfile : null });
  if (!profile) return NextResponse.json({ error: 'Kanál nenalezen.' }, { status: 404 });
  // Kdo se ptá a jestli je z týmu Kine - zjišťuje se jen když je to potřeba
  // (stránka se ptá často, ověření přihlášení stojí dotaz na Supabase).
  let requester: { id: string } | null | undefined;
  const who = async () => (requester === undefined ? (requester = await userFromRequest(req)) : requester);
  let staffMemo: boolean | undefined;
  const isStaff = async () => (staffMemo === undefined ? (staffMemo = await isStaffUser((await who())?.id)) : staffMemo);

  // Zablokovaný kanál se jako živý neukazuje nikomu, shadow-banovaný jen
  // svému majiteli (stejně jako řada "Živě" na hlavní stránce). Moderátoři
  // a správci je vidí s upozorněním, proč je ostatní nevidí.
  let restricted: LiveRestriction | null = null;
  if (banned || shadowBanned) {
    const own = !banned && (await who())?.id === channel;
    if (!own) {
      if (!(await isStaff())) {
        return NextResponse.json({ enabled: true, live: false, profile: publicProfile, stream: null }, { headers: { 'Cache-Control': 'no-store' } });
      }
      restricted = banned ? 'banned' : 'shadow-ban';
    }
  }
  if (!row) return NextResponse.json({ enabled: true, live: false, profile: publicProfile, stream: null }, { headers: { 'Cache-Control': 'no-store' } });
  const stream = await publicLive(row as LiveStreamRow);
  if (stream.live) runInBackground(import('@/lib/nudityScan').then((m) => m.scanLiveStreams()), 'kontrola obsahu přenosů');

  // Přenos skrytý automatickou kontrolou obsahu: divákům bez přehrávače
  // ("čeká na kontrolu"), majitel a moderátoři Kine ho vidí i s upozorněním.
  // Skrytí platí jen pro přenos, při kterém vzniklo (lib/nudityRules.ts).
  if (liveHiddenNow(row as any) && stream.live) {
    const own = (await who())?.id === channel;
    const privileged = own || (await isStaff());
    if (!privileged) {
      return NextResponse.json(
        { enabled: true, live: true, held: true, profile: publicProfile, stream: { ...stream, playerUrl: null, inputId: null, videoUid: null, thumbnailUrl: null } },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { enabled: true, live: true, profile: publicProfile, stream, moderation: { hidden: true, restricted, own } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // Podpory ve vysílání (tlačítko 💛 u přenosu): jen když kanál běží a umí je přijmout.
  const tips = stream.live ? { enabled: await tipsEnabled(channel), feePercent: tipFeePercent(process.env.LIVE_TIP_FEE_PERCENT) } : { enabled: false, feePercent: 0 };
  // Po vysílání: odkaz na záznam (když ho tvůrce zveřejnil) - kdo přišel pozdě, pustí si ho.
  const lastRecording = stream.live ? null : await latestRecording(channel);
  return NextResponse.json(
    { enabled: true, live: stream.live, profile: publicProfile, stream, tips, lastRecording, ...(restricted ? { moderation: { hidden: false, restricted } } : {}) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
