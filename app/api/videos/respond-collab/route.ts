import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { videoId, accept } = await req.json();
  if (!videoId) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  if (accept) {
    await supabaseServer
      .from('video_collaborators')
      .update({ status: 'accepted' })
      .eq('video_id', videoId)
      .eq('profile_id', userData.user.id);

    // Pokud už na tohle video nečeká na potvrzení nikdo další, appka mu
    // vrátí zpátky viditelnost, kterou si tvůrce původně zvolil.
    const { data: stillPending } = await supabaseServer
      .from('video_collaborators')
      .select('profile_id')
      .eq('video_id', videoId)
      .eq('status', 'pending');

    if (!stillPending || stillPending.length === 0) {
      const { data: videoRow } = await supabaseServer
        .from('videos')
        .select('pending_collab_visibility')
        .eq('id', videoId)
        .single();

      if (videoRow?.pending_collab_visibility) {
        await supabaseServer
          .from('videos')
          .update({ visibility: videoRow.pending_collab_visibility, pending_collab_visibility: null })
          .eq('id', videoId);
      }
    }
  } else {
    await supabaseServer
      .from('video_collaborators')
      .delete()
      .eq('video_id', videoId)
      .eq('profile_id', userData.user.id);
  }

  return NextResponse.json({ ok: true });
}
