import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { supabaseAsUser, bearerFrom } from '@/lib/supabaseAsUser';
import { CLIPS_PER_DAY, clipTitle, normalizeClipRange } from '@/lib/clips';

/**
 * Vystřižení klipu: POST { videoId, start, end } -> { clipId }
 *
 * Cloudflare Stream má na to hotové API ("clip"): z existujícího videa
 * vyrobí nové, bez stahování a překódování u nás. Nový řádek ve videos
 * vlastní PŮVODNÍ TVŮRCE, klipující je uvedený v clipped_by (lib/clips.ts,
 * supabase-migration-klipy.sql). Video se zpracovává stejně jako nahrané -
 * webhook nebo doptání ho přepne na "ready".
 *
 * Kdo smí: přihlášený, který video vidí (rozhodne databáze přes RLS) a
 * video je veřejné a hotové. Klip ze soukromého videa by z něj udělal
 * veřejné - to ne.
 */
export async function POST(req: NextRequest) {
  const token = bearerFrom(req);
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({}));
  const videoId = typeof body?.videoId === 'string' ? body.videoId : null;
  if (!videoId) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  // Vidí divák video? Stejná pravidla jako všude (RLS).
  const { data: video } = await supabaseAsUser(token)
    .from('videos')
    .select('id, owner_id, title, description, cloudflare_video_id, duration_seconds, visibility, status, category, language, made_for_kids, hashtags, width, height')
    .eq('id', videoId)
    .maybeSingle();

  if (!video || !video.cloudflare_video_id) {
    return NextResponse.json({ error: 'Video nenalezeno nebo k němu nemáš přístup.' }, { status: 403 });
  }
  if (video.visibility !== 'public' || video.status !== 'ready') {
    return NextResponse.json({ error: 'Klip jde vystřihnout jen z veřejného, hotového videa.', code: 'not-public' }, { status: 400 });
  }

  const range = normalizeClipRange(Number(body?.start), Number(body?.end), Number(video.duration_seconds ?? 0));
  if (!range.ok) {
    return NextResponse.json({ error: 'Neplatný rozsah klipu.', code: range.reason }, { status: 400 });
  }

  // Denní strop na klipy jednoho účtu - každý klip je nové video u Cloudflare.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: clipsToday, error: countError } = await supabaseServer
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('clipped_by', userId)
    .gte('created_at', since24h);

  if (countError) {
    // Sloupec ještě není (migrace neproběhla) - klipy bez ní nejdou.
    return NextResponse.json({ error: 'Klipy zatím nejsou zapnuté (chybí migrace supabase-migration-klipy.sql).', code: 'not-configured' }, { status: 503 });
  }
  if ((clipsToday ?? 0) >= CLIPS_PER_DAY) {
    return NextResponse.json({ error: `Dnes už máš ${CLIPS_PER_DAY} klipů. Zkus to zítra.`, code: 'limit' }, { status: 429 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  const title = clipTitle(video.title, range.start, range.end);

  let clipUid: string | null = null;
  try {
    const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/clip`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clippedFromVideoUID: video.cloudflare_video_id,
        startTimeSeconds: range.start,
        endTimeSeconds: range.end,
        thumbnailTimestampPct: 0.1,
        meta: { name: title },
      }),
    });
    const cfData = await cfRes.json().catch(() => ({ success: false }));
    if (!cfData?.success || !cfData?.result?.uid) {
      return NextResponse.json(
        { error: 'Cloudflare klip odmítl.', details: cfData?.errors ?? cfRes.status },
        { status: 502 }
      );
    }
    clipUid = cfData.result.uid as string;
  } catch (e: any) {
    return NextResponse.json({ error: 'Cloudflare se nepodařilo zavolat.', details: e?.message }, { status: 502 });
  }

  const { data: clip, error: insertError } = await supabaseServer
    .from('videos')
    .insert({
      owner_id: video.owner_id,
      title,
      description: video.description ?? null,
      cloudflare_video_id: clipUid,
      status: 'processing',
      visibility: 'public',
      category: video.category ?? null,
      language: video.language ?? 'cs',
      made_for_kids: video.made_for_kids ?? false,
      hashtags: video.hashtags ?? [],
      width: video.width ?? null,
      height: video.height ?? null,
      duration_seconds: range.end - range.start,
      chapters: [],
      captions: [],
      clipped_from_video_id: video.id,
      clipped_by: userId,
    })
    .select('id')
    .single();

  if (insertError || !clip) {
    return NextResponse.json({ error: insertError?.message ?? 'Klip se nepodařilo uložit.' }, { status: 500 });
  }

  return NextResponse.json({ clipId: clip.id, start: range.start, end: range.end, title });
}
