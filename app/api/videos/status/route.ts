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
    .select('id, cloudflare_video_id, status, custom_thumbnail, owner_id, title, visibility')
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

    // Video se právě stalo "ready" a je veřejné - vhodná chvíle poslat
    // oznámení odběratelům, kteří si to u tohohle kanálu přejí (zvoneček
    // vedle "Odebírat").
    if (video.visibility === 'public') {
      const { data: subs } = await supabaseServer
        .from('subscriptions')
        .select('subscriber_id')
        .eq('channel_id', video.owner_id)
        .eq('notify_new_videos', true);

      if (subs && subs.length > 0) {
        const rows = subs.map((s: any) => ({
          user_id: s.subscriber_id,
          type: 'new_video',
          message: `Nové video: "${video.title}"`,
          link: `/watch/${videoId}`,
        }));
        await supabaseServer.from('notifications').insert(rows);
      }
    }

    return NextResponse.json({ status: 'ready' });
  }

  return NextResponse.json({ status: 'processing' });
}
