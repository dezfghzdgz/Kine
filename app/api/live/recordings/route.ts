import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { listInputVideos } from '@/lib/liveStream';
import { parseRecordingVisibility, publishRecording } from '@/lib/liveRecording';

export const dynamic = 'force-dynamic';

/**
 * Záznamy živých vysílání (Cloudflare je nahrává samo). Tvůrce vidí svoje
 * a jedním klikem z nich udělá normální video na Kine (lib/liveRecording.ts).
 * Nezveřejněné záznamy Cloudflare po 30 dnech smaže; zveřejněné zůstávají.
 */
async function myInput(ownerId: string) {
  const { data, error } = await supabaseServer.from('live_inputs').select('cf_input_id').eq('owner_id', ownerId).maybeSingle();
  return { inputId: data?.cf_input_id as string | undefined, error };
}

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { inputId, error } = await myInput(user.id);
  if (isMissingTable(error)) return NextResponse.json({ recordings: [] });
  if (!inputId) return NextResponse.json({ recordings: [] });

  let recordings;
  try {
    recordings = await listInputVideos(inputId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, recordings: [] }, { status: 502 });
  }
  const uids = recordings.map((r) => r.uid);
  const published = new Map<string, string>();
  if (uids.length > 0) {
    const { data } = await supabaseServer.from('videos').select('id, cloudflare_video_id').eq('owner_id', user.id).in('cloudflare_video_id', uids);
    for (const v of data ?? []) published.set(v.cloudflare_video_id, v.id);
  }
  // Záznam, který Cloudflare po konci vysílání ještě uzavírá, jde zveřejnit taky (jen ne během vysílání).
  const { data: stream } = await supabaseServer.from('live_streams').select('is_live').eq('owner_id', user.id).maybeSingle();
  return NextResponse.json({
    streamLive: !!stream?.is_live,
    recordings: recordings.slice(0, 30).map((r) => ({ ...r, videoId: published.get(r.uid) ?? null })),
  });
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  // "latest" = nejnovější záznam (appka Kine po skončení vysílání neví jeho id).
  const uid = String(body?.videoUid ?? '').trim() || 'latest';
  const result = await publishRecording(user.id, {
    videoUid: uid,
    title: typeof body?.title === 'string' ? body.title : undefined,
    description: typeof body?.description === 'string' ? body.description : undefined,
    visibility: parseRecordingVisibility(body?.visibility) ?? 'public',
    language: typeof body?.language === 'string' ? body.language : undefined,
    rightAfterStream: body?.rightAfterStream === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ videoId: result.videoId, status: result.status, alreadyPublished: result.alreadyPublished });
}
