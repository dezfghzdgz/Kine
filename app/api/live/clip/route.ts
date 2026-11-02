import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { isCloudflareUid } from '@/lib/cloudflareVideos';
import { channelRoom } from '@/lib/liveChat';
import { activeBan } from '@/lib/liveChatModeration';
import { cloudflareVideo, streamCustomerCode, type LiveStreamRow } from '@/lib/liveStream';
import { liveHiddenNow } from '@/lib/nudityRules';
import { LIVE_CLIP_SECONDS, liveClipFilename, liveClipMp4Url, liveClipWindow, livePreviewManifestUrl, readPreviewStart } from '@/lib/liveClip';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const noStore = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string, code?: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...(code ? { code } : {}), ...extra }, { status, headers: noStore });

/**
 * Klip z živého vysílání: POST { channel } -> { url, filename, seconds }
 *
 * Vrátí adresu MP4 s posledními ~30 s přenosu (lib/liveClip.ts) a divákovi
 * se klip stáhne do zařízení (components/LiveClipButton.tsx). Cloudflare ho
 * vyrobí ze záznamu vysílání, až si ho prohlížeč stáhne - nic se neukládá,
 * neplatí se za úložiště a na Kine nevzniká nové video (dřív se každý klip
 * kopíroval jako video na kanál streamera).
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return fail(401, 'Musíš být přihlášený.', 'auth');
  if (!allowRequest(`live-clip:${user.id}`, 6, 60 * 1000)) return tooManyRequests(20);

  const body = await req.json().catch(() => ({}));
  const channel = typeof body?.channel === 'string' && UUID.test(body.channel) ? body.channel.toLowerCase() : null;
  if (!channel) return fail(400, 'Neplatný kanál.');

  const [meRes, rowRes, ownerRes, chatBan] = await Promise.all([
    supabaseServer.from('profiles').select('is_banned').eq('id', user.id).maybeSingle(),
    supabaseServer.from('live_streams').select('*').eq('owner_id', channel).maybeSingle(),
    supabaseServer.from('profiles').select('username, display_name, is_banned, is_shadow_banned').eq('id', channel).maybeSingle(),
    activeBan(channelRoom(channel), user.id),
  ]);
  if ((meRes.data as { is_banned?: boolean } | null)?.is_banned) return fail(403, 'Účet je zablokovaný.', 'banned');
  // Kdo má v chatu kanálu zákaz, ten si z něj klipy nestahuje.
  if (chatBan) return fail(403, 'Na tomhle kanálu teď klipy dělat nemůžeš.', 'blocked');
  if (isMissingTable(rowRes.error) || !rowRes.data || !ownerRes.data) return fail(404, 'Přenos nenalezen.', 'not-found');
  const stream = rowRes.data as LiveStreamRow;
  const owner = ownerRes.data as { username: string | null; display_name: string | null; is_banned?: boolean; is_shadow_banned?: boolean };
  const uid = stream.current_video_uid;
  if (!stream.is_live || !isCloudflareUid(uid)) return fail(409, 'Kanál teď nevysílá.', 'not-live');
  // Přenos, který ostatní nevidí (zablokovaný, shadow-ban, skrytý kontrolou obsahu), se neklipuje.
  if (owner.is_banned || owner.is_shadow_banned || liveHiddenNow(stream as any)) return fail(403, 'Z tohohle přenosu teď klip udělat nejde.', 'unavailable');

  const code = await streamCustomerCode();
  if (!code) return fail(503, 'Klipy z vysílání teď nejdou (Cloudflare není nastavený).', 'not-configured');

  // Kde začíná posledních 30 s (hlavička náhledového manifestu), jinak z délky vysílání.
  let previewStart: number | null = null;
  const manifest = livePreviewManifestUrl(code, uid);
  if (manifest) {
    try {
      const res = await fetch(manifest, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      previewStart = res.ok ? readPreviewStart(res.headers.get('preview-start-seconds')) : null;
    } catch {
      previewStart = null;
    }
  }
  const startedMs = Date.parse(stream.started_at ?? '');
  let elapsed: number | null = Number.isFinite(startedMs) ? (Date.now() - startedMs) / 1000 : null;
  if (previewStart === null) {
    // Cloudflare ví přesně, kdy záznam začal (náš čas začátku může být o pár vteřin pozadu).
    const video = await cloudflareVideo(uid);
    const created = Date.parse(video?.created ?? '');
    if (Number.isFinite(created)) elapsed = (Date.now() - created) / 1000;
  } else if (elapsed !== null && elapsed > 2 * LIVE_CLIP_SECONDS) {
    // Dlouhé vysílání: strop podle našeho času začátku není potřeba (a mohl by klip zbytečně zkrátit).
    elapsed = null;
  }
  const window = liveClipWindow({ previewStart, elapsed });
  if (!window.ok) {
    return window.reason === 'too-early'
      ? fail(409, 'Vysílání teprve začalo - klip půjde za pár vteřin.', 'too-early')
      : fail(503, 'Klip teď nejde udělat - zkus to za chvíli.', 'unavailable');
  }
  const filename = liveClipFilename(owner.username || owner.display_name);
  const url = liveClipMp4Url(code, uid, window, filename);
  if (!url) return fail(503, 'Klip teď nejde udělat - zkus to za chvíli.', 'unavailable');
  return NextResponse.json({ url, filename, seconds: window.duration }, { headers: noStore });
}
