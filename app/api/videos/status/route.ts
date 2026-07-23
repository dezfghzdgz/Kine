import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Zeptá se Cloudflare Stream, jestli je video už zpracované, a pokud ano,
// aktualizuje záznam v naší databázi (status, náhledový obrázek, délka).
export async function POST(req: NextRequest) {
  const { videoId } = await req.json();

  if (!videoId) {
    return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });
  }

  const { data: video } = await supabaseServer
    .from('videos')
    .select('id, cloudflare_video_id, status, custom_thumbnail')
    .eq('id', videoId)
    .single();

  if (!video) {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }

  if (video.status === 'ready') {
    return NextResponse.json({ status: 'ready' });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${video.cloudflare_video_id}`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const cfData = await cfRes.json();

  if (!cfData.success) {
    return NextResponse.json({ status: 'processing' });
  }

  const result = cfData.result;

  if (result.readyToStream) {
    const updates: any = {
      status: 'ready',
      duration_seconds: Math.round(result.duration || 0),
    };
    if (!video.custom_thumbnail) {
      updates.thumbnail_url = result.thumbnail;
    }
    if (result.input?.width) updates.width = result.input.width;
    if (result.input?.height) updates.height = result.input.height;
    await supabaseServer.from('videos').update(updates).eq('id', videoId);

    return NextResponse.json({ status: 'ready' });
  }

  return NextResponse.json({ status: 'processing' });
}
