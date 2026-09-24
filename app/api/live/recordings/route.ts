import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { cloudflareVideo, keepRecording, listInputVideos } from '@/lib/liveStream';
import { refreshFromCloudflare } from '@/lib/markVideoReady';
import { shouldBeProtected, syncVideoProtection } from '@/lib/streamProtection';

export const dynamic = 'force-dynamic';

/**
 * Záznamy živých vysílání (Cloudflare je nahrává samo). Tvůrce vidí svoje
 * a jedním klikem z nich udělá normální video na Kine. Nezveřejněné
 * záznamy Cloudflare po 30 dnech smaže.
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
  return NextResponse.json({
    recordings: recordings.slice(0, 30).map((r) => ({ ...r, videoId: published.get(r.uid) ?? null })),
  });
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const uid = String(body?.videoUid ?? '');
  const title = String(body?.title ?? '').trim().slice(0, 150);
  const description = String(body?.description ?? '').trim().slice(0, 5000);
  const visibility = ['public', 'private', 'subscribers'].includes(body?.visibility) ? body.visibility : 'public';
  if (!uid || !title) return NextResponse.json({ error: 'Chybí záznam nebo název.' }, { status: 400 });

  const { inputId } = await myInput(user.id);
  if (!inputId) return NextResponse.json({ error: 'Nemáš založené živé vysílání.' }, { status: 404 });

  // Záznam musí patřit k MÉMU vstupu - jinak by si kdokoliv mohl "zveřejnit" cizí vysílání.
  let recordings;
  try {
    recordings = await listInputVideos(inputId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  const rec = recordings.find((r) => r.uid === uid);
  if (!rec) return NextResponse.json({ error: 'Záznam nenalezen.' }, { status: 404 });
  if (rec.state === 'live-inprogress') return NextResponse.json({ error: 'Vysílání ještě běží.' }, { status: 409 });

  const existing = await supabaseServer.from('videos').select('id').eq('owner_id', user.id).eq('cloudflare_video_id', uid).maybeSingle();
  if (existing.data) return NextResponse.json({ videoId: existing.data.id });

  const { data: stream } = await supabaseServer.from('live_streams').select('category').eq('owner_id', user.id).maybeSingle();
  const info = await cloudflareVideo(uid);
  const { data: video, error } = await supabaseServer
    .from('videos')
    .insert({
      owner_id: user.id,
      title,
      description,
      cloudflare_video_id: uid,
      status: 'processing',
      visibility,
      category: stream?.category ?? null,
      language: typeof body?.language === 'string' ? body.language.slice(0, 5) : 'cs',
      width: info?.input?.width ?? null,
      height: info?.input?.height ?? null,
      chapters: [],
      captions: [],
      hashtags: [],
    })
    .select('id')
    .single();
  if (error || !video) return NextResponse.json({ error: error?.message ?? 'Uložení se nepovedlo.' }, { status: 500 });

  await keepRecording(uid);
  if (shouldBeProtected(visibility)) await syncVideoProtection(video.id);
  // Záznam je u Cloudflare obvykle hotový - přepne se na "ready" hned (a odběratelé dostanou oznámení).
  await refreshFromCloudflare(video.id).catch(() => undefined);
  return NextResponse.json({ videoId: video.id });
}
