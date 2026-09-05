import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { syncVideoProtection } from '@/lib/streamProtection';

/**
 * Odpověď na pozvánku ke spolupráci na videu.
 *
 * Přijetí   -> spolutvůrce se u videa zveřejní a video se objeví i na jeho kanálu.
 * Odmítnutí -> ze spolupráce odejde jen on sám. Video zůstává tvůrci.
 *
 * Dřív odmítnutí smazalo CELÉ video (i z Cloudflare) - stačilo, aby jeden
 * pozvaný kliknul na "Odmítnout", a nahrávající o video nenávratně přišel.
 * Kromě toho video zůstalo navždy soukromé, když se pozvaný neozval; teď se
 * viditelnost vrátí, jakmile na potvrzení nikdo další nečeká.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { videoId, accept } = await req.json();
  if (!videoId) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  if (accept) {
    const { error } = await supabaseServer
      .from('video_collaborators')
      .update({ status: 'accepted' })
      .eq('video_id', videoId)
      .eq('profile_id', userData.user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await supabaseServer
      .from('video_collaborators')
      .delete()
      .eq('video_id', videoId)
      .eq('profile_id', userData.user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await releaseVisibilityIfEveryoneAnswered(videoId);

  return NextResponse.json({ ok: true, accepted: !!accept });
}

/**
 * Dokud video čeká na potvrzení, drží ho appka jako soukromé. Jakmile na
 * odpověď nikdo další nečeká - ať už všichni přijali, nebo někdo odmítl -
 * vrátí se viditelnost, kterou tvůrce původně zvolil. Video tak nezůstane
 * uvězněné jako soukromé kvůli někomu, kdo se nikdy neozval.
 */
async function releaseVisibilityIfEveryoneAnswered(videoId: string) {
  const { data: stillPending } = await supabaseServer
    .from('video_collaborators')
    .select('profile_id')
    .eq('video_id', videoId)
    .eq('status', 'pending');

  if (stillPending && stillPending.length > 0) return;

  const { data: videoRow } = await supabaseServer
    .from('videos')
    .select('pending_collab_visibility')
    .eq('id', videoId)
    .maybeSingle();

  if (videoRow?.pending_collab_visibility) {
    await supabaseServer
      .from('videos')
      .update({ visibility: videoRow.pending_collab_visibility, pending_collab_visibility: null })
      .eq('id', videoId);
    // Viditelnost se změnila -> ochrana podepsanými adresami se srovná
    // (lib/streamProtection.ts; bez nastaveného klíče nic nedělá).
    await syncVideoProtection(videoId);
  }
}
