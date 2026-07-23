import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Zvýší počet zhlédnutí. Volá se z appky až POTÉ, co se klientovi
// podařilo video načíst (tedy má na něj právo dívat se) - takže sem
// se dostanou jen legitimní zhlédnutí.
export async function POST(req: NextRequest) {
  const { videoId } = await req.json();
  if (!videoId) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  const { data: video } = await supabaseServer.from('videos').select('views').eq('id', videoId).single();
  if (!video) return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });

  await supabaseServer.from('videos').update({ views: (video.views ?? 0) + 1 }).eq('id', videoId);
  await supabaseServer.from('views_log').insert({ video_id: videoId });

  return NextResponse.json({ success: true });
}
