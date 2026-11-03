import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { frameId, frameUrl } from '@/lib/nudityScan';
import { syncVideoProtection } from '@/lib/streamProtection';
import { notifySubscribers } from '@/lib/markVideoReady';
import { liveFlagIsCurrent } from '@/lib/nudityRules';
import { visibilityAfterApproval, visibilityBeforeHold } from '@/lib/moderationVisibility';
import { emotePathFromUrl } from '@/lib/emoteImage';

export const dynamic = 'force-dynamic';

/**
 * Fronta automatické kontroly obsahu pro moderátory (stránka /reports):
 * videa a přenosy, kde model našel možnou nahotu nebo porno
 * (lib/nudityScan.ts), a emoty kanálů, které server sám zkontrolovat neumí
 * (GIF, WebP, animované PNG - čekají na schválení; app/api/live/chat/emotes).
 * Moderátor obsah pustí (byl to omyl / umění), nebo nechá skrytý.
 *
 * GET  ?status=open|all       seznam (jen moderátoři a správci)
 * POST { id, action: 'approve' | 'remove' }   (id emotu jako "emote:<uuid>")
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function staffUser(req: NextRequest): Promise<{ id: string } | null> {
  const user = await userFromRequest(req);
  if (!user) return null;
  const { data } = await supabaseServer.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return data?.role === 'moderator' || data?.role === 'admin' ? { id: user.id } : null;
}

type Flag = {
  id: number;
  kind: 'video' | 'live';
  video_id: string | null;
  channel_id: string;
  live_video_uid: string | null;
  verdict: 'hidden' | 'review';
  reason: string;
  scores: any[];
  artistic: boolean;
  status: 'open' | 'approved' | 'removed';
  reviewed_at: string | null;
  created_at: string;
};

type PendingEmote = { id: string; channel_id: string; code: string; image_url: string; created_at: string };

/** Emoty čekající na schválení (sloupec review_status je z migrace kontroly emotů; bez ní žádné). */
async function pendingEmotes(): Promise<PendingEmote[]> {
  const { data, error } = await supabaseServer
    .from('channel_emotes')
    .select('id, channel_id, code, image_url, created_at')
    .eq('review_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100);
  return error ? [] : ((data ?? []) as PendingEmote[]);
}

/** Kolik spolutvůrců na video pořád čeká (bez sloupce status - starší databáze - nikdo). */
async function pendingCollaborators(videoId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from('video_collaborators')
    .select('profile_id', { count: 'exact', head: true })
    .eq('video_id', videoId)
    .eq('status', 'pending');
  return error ? 0 : count ?? 0;
}

export async function GET(req: NextRequest) {
  if (!(await staffUser(req))) return NextResponse.json({ error: 'Jen pro moderátory.' }, { status: 403 });
  const status = req.nextUrl.searchParams.get('status') === 'all' ? 'all' : 'open';
  let query = supabaseServer.from('content_flags').select('*').order('created_at', { ascending: false }).limit(100);
  if (status === 'open') query = query.eq('status', 'open');
  const [{ data, error }, emotes] = await Promise.all([query, pendingEmotes()]);
  if (isMissingTable(error) && emotes.length === 0) return NextResponse.json({ available: false, items: [] });
  if (error && !isMissingTable(error)) return NextResponse.json({ error: error.message }, { status: 500 });
  const flags = (error ? [] : data ?? []) as Flag[];

  const videoIds = [...new Set(flags.map((f) => f.video_id).filter(Boolean))] as string[];
  const channelIds = [...new Set([...flags.map((f) => f.channel_id), ...emotes.map((e) => e.channel_id)])];
  const [videos, profiles] = await Promise.all([
    videoIds.length ? supabaseServer.from('videos').select('*').in('id', videoIds) : Promise.resolve({ data: [] as any[] }),
    channelIds.length ? supabaseServer.from('profiles').select('id, username, display_name').in('id', channelIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const videoMap = new Map<string, any>((videos.data ?? []).map((v: any) => [v.id, v]));
  const profileMap = new Map<string, any>((profiles.data ?? []).map((p: any) => [p.id, p]));
  const channelOf = (id: string) => {
    const profile = profileMap.get(id) ?? null;
    return profile ? { id: profile.id, name: profile.display_name || profile.username } : { id, name: '—' };
  };

  const items = flags.map((f) => {
    const video = f.video_id ? videoMap.get(f.video_id) ?? null : null;
    let frames: { url: string; porn: number | null; sexy: number | null; t: number | null }[] = [];
    if (f.kind === 'video' && video?.cloudflare_video_id) {
      // Podepsané na hodinu - u skrytého (chráněného) videa by holé id Cloudflare nevydal.
      const id = frameId(video.cloudflare_video_id, 60 * 60);
      frames = (Array.isArray(f.scores) ? f.scores : []).map((s: any) => ({
        url: s?.t === null || s?.t === undefined ? video.thumbnail_url ?? frameUrl(id, 0, 270) : frameUrl(id, Number(s.t) || 0, 270),
        porn: typeof s?.porn === 'number' ? s.porn : null,
        sexy: typeof s?.sexy === 'number' ? s.sexy : null,
        t: typeof s?.t === 'number' ? s.t : null,
      }));
    } else if (f.kind === 'live' && f.live_video_uid) {
      frames = [{ url: frameUrl(f.live_video_uid, null, 270), porn: null, sexy: null, t: null }];
    }
    return {
      id: f.id as number | string,
      kind: f.kind as 'video' | 'live' | 'emote',
      verdict: f.verdict,
      reason: f.reason,
      status: f.status,
      artistic: !!f.artistic,
      createdAt: f.created_at,
      reviewedAt: f.reviewed_at,
      channel: channelOf(f.channel_id),
      video: video ? { id: video.id, title: video.title, visibility: video.visibility, hold: video.moderation_hold ?? null } : null,
      strikes: f.kind === 'live' ? (Array.isArray(f.scores) ? f.scores.length : 0) : null,
      frames,
    };
  });

  // Emoty čekající na schválení - jako položky fronty (id "emote:<uuid>", obrázek místo snímků).
  const emoteItems = emotes.map((e) => ({
    id: `emote:${e.id}` as number | string,
    kind: 'emote' as 'video' | 'live' | 'emote',
    verdict: 'review' as const,
    reason: 'nudity',
    status: 'open' as const,
    artistic: false,
    createdAt: e.created_at,
    reviewedAt: null,
    channel: channelOf(e.channel_id),
    video: null,
    emote: { id: e.id, code: e.code },
    strikes: null,
    frames: [{ url: e.image_url, porn: null, sexy: null, t: null }],
  }));

  const all = [...items, ...emoteItems].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return NextResponse.json({ available: true, items: all }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Schválení / odmítnutí emotu čekajícího na kontrolu. */
async function reviewEmote(emoteId: string, action: 'approve' | 'remove'): Promise<NextResponse> {
  if (!UUID.test(emoteId)) return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  const { data, error } = await supabaseServer.from('channel_emotes').select('id, channel_id, code, image_url').eq('id', emoteId).maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Položka nenalezena.' }, { status: 404 });
  const emote = data as { id: string; channel_id: string; code: string; image_url: string };
  if (action === 'approve') {
    const { error: upd } = await supabaseServer.from('channel_emotes').update({ review_status: 'approved' }).eq('id', emote.id);
    if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  await supabaseServer.from('channel_emotes').delete().eq('id', emote.id);
  const path = emotePathFromUrl(emote.image_url, emote.channel_id);
  if (path) await supabaseServer.storage.from('thumbnails').remove([path]).then(() => undefined, () => undefined);
  await supabaseServer.from('notifications').insert({
    user_id: emote.channel_id,
    type: 'moderation_warning',
    message: `⚠️ Emote ${emote.code} jsme odebrali - moderátor ho neschválil (pravidla Kine nedovolují nahotu ani porno). Můžeš nahrát jiný.`,
    link: '/live',
  });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const staff = await staffUser(req);
  if (!staff) return NextResponse.json({ error: 'Jen pro moderátory.' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const action = body?.action === 'approve' ? 'approve' : body?.action === 'remove' ? 'remove' : null;
  if (typeof body?.id === 'string' && body.id.startsWith('emote:') && action) return reviewEmote(body.id.slice('emote:'.length), action);
  const id = Number(body?.id);
  if (!Number.isFinite(id) || id <= 0 || !action) return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });

  const { data: flag, error } = await supabaseServer.from('content_flags').select('*').eq('id', id).maybeSingle();
  if (error || !flag) return NextResponse.json({ error: 'Položka nenalezena.' }, { status: 404 });
  const f = flag as Flag;
  const nowIso = new Date().toISOString();

  if (f.kind === 'video' && f.video_id) {
    const { data: video } = await supabaseServer.from('videos').select('*').eq('id', f.video_id).maybeSingle();
    if (video) {
      const title = String(video.title ?? '').slice(0, 80);
      // Sloupec čekající viditelnosti (spolupráce) je z migrace collab-visibility - bez ní se nezapisuje.
      const hasPendingCollab = Object.prototype.hasOwnProperty.call(video, 'pending_collab_visibility');
      if (action === 'approve') {
        if (video.moderation_hold) {
          // Na video pořád čekají spolutvůrci: zůstane soukromé a chtěná viditelnost se vrátí
          // do čekání - zveřejní ho až poslední odpověď (app/api/videos/respond-collab).
          const after = hasPendingCollab
            ? visibilityAfterApproval(video, await pendingCollaborators(video.id))
            : { visibility: video.moderation_prev_visibility || 'public', pendingCollab: null };
          const patch: Record<string, unknown> = { visibility: after.visibility, moderation_hold: null, moderation_prev_visibility: null };
          if (hasPendingCollab) patch.pending_collab_visibility = after.pendingCollab;
          const { error: upd } = await supabaseServer.from('videos').update(patch).eq('id', video.id);
          if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });
          await syncVideoProtection(video.id).catch(() => undefined);
          await supabaseServer.from('notifications').insert({
            user_id: video.owner_id,
            type: 'moderation_warning',
            message: `✅ Video „${title}“ prošlo kontrolou a je zase vidět.`,
            link: `/watch/${video.id}`,
          });
          // Odběratelé se o něm ještě nedozvěděli (skryté video se nehlásí).
          const scheduledLater = video.scheduled_at && new Date(video.scheduled_at).getTime() > Date.now();
          if (after.visibility === 'public' && !video.clipped_from_video_id && !video.clipped_by && !scheduledLater) await notifySubscribers(video).catch(() => undefined);
        }
      } else {
        const patch: Record<string, unknown> = {
          moderation_hold: 'removed',
          moderation_prev_visibility: video.moderation_prev_visibility ?? visibilityBeforeHold(video),
          visibility: 'private',
        };
        // Čekající viditelnost (spolupráce) pryč - jinak by ji odpověď spolutvůrce vrátila.
        if (hasPendingCollab) patch.pending_collab_visibility = null;
        const { error: upd } = await supabaseServer.from('videos').update(patch).eq('id', video.id);
        if (upd) return NextResponse.json({ error: upd.message }, { status: 500 });
        if (video.visibility !== 'private') await syncVideoProtection(video.id).catch(() => undefined);
        await supabaseServer.from('notifications').insert({
          user_id: video.owner_id,
          type: 'moderation_warning',
          message: `⛔ Video „${title}“ zůstává skryté - moderátor potvrdil, že porušuje pravidla Kine (nahota nebo porno). Vidíš ho jen ty.`,
          link: `/watch/${video.id}`,
        });
      }
    }
  } else if (f.kind === 'live') {
    const { data: row } = await supabaseServer.from('live_streams').select('*').eq('owner_id', f.channel_id).maybeSingle();
    // Skrytí platí jen pro přenos, při kterém vzniklo (lib/nudityRules.ts - liveHiddenNow).
    // Hlášení ze staršího skrytí nesmí pustit pozdější přenos, který kontrola skryla sama za sebe.
    const current = liveFlagIsCurrent(row, f.created_at);
    if (action === 'approve') {
      if (current) {
        await supabaseServer
          .from('live_streams')
          .update({ moderation_hidden_at: null, moderation_strikes: [], moderation_cleared_uid: row?.current_video_uid ?? f.live_video_uid ?? null })
          .eq('owner_id', f.channel_id);
      }
      await supabaseServer.from('notifications').insert({
        user_id: f.channel_id,
        type: 'moderation_warning',
        message: current
          ? '✅ Tvůj přenos prošel kontrolou moderátora - už není skrytý a je vidět na hlavní stránce i na stránce Živě.'
          : '✅ Moderátor zkontroloval tvůj dřívější přenos - byl v pořádku.',
        link: `/live/${f.channel_id}`,
      });
    } else {
      await supabaseServer.from('notifications').insert({
        user_id: f.channel_id,
        type: 'moderation_warning',
        message: current
          ? '⛔ Moderátor potvrdil v tvém přenosu nahotu nebo porno, což pravidla Kine nedovolují - přenos zůstává skrytý.'
          : '⛔ Moderátor potvrdil v tvém dřívějším přenosu nahotu nebo porno, což pravidla Kine nedovolují.',
        link: `/live/${f.channel_id}`,
      });
    }
  }

  const { error: done } = await supabaseServer
    .from('content_flags')
    .update({ status: action === 'approve' ? 'approved' : 'removed', reviewed_by: staff.id, reviewed_at: nowIso })
    .eq('id', id);
  if (done) return NextResponse.json({ error: done.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
