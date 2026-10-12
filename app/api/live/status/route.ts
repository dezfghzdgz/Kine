import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { publicLive, syncLiveStreams, type LiveStreamRow } from '@/lib/liveStream';
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
  // Zablokovaný kanál se jako živý neukazuje nikomu, shadow-banovaný jen
  // svému majiteli (stejně jako řada "Živě" na hlavní stránce).
  let requester: { id: string } | null | undefined;
  const who = async () => (requester === undefined ? (requester = await userFromRequest(req)) : requester);
  const hidden = !!banned || (!!shadowBanned && (await who())?.id !== channel);
  if (!row || hidden) return NextResponse.json({ enabled: true, live: false, profile: publicProfile, stream: null }, { headers: { 'Cache-Control': 'no-store' } });
  const stream = await publicLive(row as LiveStreamRow);
  if (stream.live) runInBackground(import('@/lib/nudityScan').then((m) => m.scanLiveStreams()), 'kontrola obsahu přenosů');

  // Přenos skrytý automatickou kontrolou obsahu: divákům bez přehrávače
  // ("čeká na kontrolu"), majitel a moderátoři Kine ho vidí i s upozorněním.
  if ((row as any).moderation_hidden_at && stream.live) {
    const me = await who();
    let privileged = me?.id === channel;
    if (!privileged && me) {
      const { data: role } = await supabaseServer.from('profiles').select('role').eq('id', me.id).maybeSingle();
      privileged = role?.role === 'moderator' || role?.role === 'admin';
    }
    if (!privileged) {
      return NextResponse.json(
        { enabled: true, live: true, held: true, profile: publicProfile, stream: { ...stream, playerUrl: null, inputId: null, videoUid: null } },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return NextResponse.json(
      { enabled: true, live: true, profile: publicProfile, stream, moderation: { hidden: true } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }
  // Podpory ve vysílání (tlačítko 💛 u přenosu): jen když kanál běží a umí je přijmout.
  const tips = stream.live ? { enabled: await tipsEnabled(channel), feePercent: tipFeePercent(process.env.LIVE_TIP_FEE_PERCENT) } : { enabled: false, feePercent: 0 };
  return NextResponse.json(
    { enabled: true, live: stream.live, profile: publicProfile, stream, tips },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
