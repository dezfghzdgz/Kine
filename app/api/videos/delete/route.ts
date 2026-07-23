import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Smaže video z Cloudflare Stream i ze záznamu v databázi.
// Ověřuje, že o smazání žádá skutečně vlastník videa.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const { videoId } = await req.json();
  if (!videoId) {
    return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });
  }

  const { data: video } = await supabaseServer
    .from('videos')
    .select('id, owner_id, cloudflare_video_id')
    .eq('id', videoId)
    .single();

  if (!video) {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }

  if (video.owner_id !== userData.user.id) {
    return NextResponse.json({ error: 'Tohle video ti nepatří.' }, { status: 403 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${video.cloudflare_video_id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } }
  );

  const { error: deleteError } = await supabaseServer.from('videos').delete().eq('id', videoId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
