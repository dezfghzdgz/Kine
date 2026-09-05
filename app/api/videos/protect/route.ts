import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { bearerFrom } from '@/lib/supabaseAsUser';
import { protectionConfigured, syncVideoProtection } from '@/lib/streamProtection';

/**
 * Srovná ochranu videa s jeho viditelností (lib/streamProtection.ts).
 *
 * Volá ho stránka úprav po uložení: soukromé video a video pro odběratele
 * dostanou u Cloudflare podepsané adresy, veřejné se zase otevře. Smí to
 * jen majitel videa. Bez nastaveného klíče vrací {outcome: 'not-configured'}
 * a nic nedělá.
 */
export async function POST(req: NextRequest) {
  const token = bearerFrom(req);
  if (!token) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // { all: true } = dorovnat všechna neveřejná videa přihlášeného tvůrce
  // naráz. Volá to stránka Moje videa, ať se ochrana zapne i u videí, která
  // byla neveřejná dřív, než ochrana vznikla - bez klikání na každé zvlášť.
  if (body?.all === true) {
    if (!protectionConfigured()) return NextResponse.json({ outcome: 'not-configured', synced: 0 });
    const { data: videos } = await supabaseServer
      .from('videos')
      .select('id')
      .eq('owner_id', userData.user.id)
      .neq('visibility', 'public')
      .limit(200);
    const failed: string[] = [];
    let changed = 0;
    for (const v of videos ?? []) {
      const r = await syncVideoProtection(v.id);
      if (r.outcome === 'failed') failed.push(v.id);
      else if (r.outcome === 'protected' || r.outcome === 'opened' || r.thumbnail === 'copied') changed += 1;
    }
    return NextResponse.json({ outcome: failed.length ? 'failed' : 'ok', synced: (videos ?? []).length, changed, failed });
  }

  const videoId = body?.videoId;
  if (!videoId || typeof videoId !== 'string') {
    return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });
  }

  const { data: video } = await supabaseServer
    .from('videos')
    .select('id, owner_id')
    .eq('id', videoId)
    .maybeSingle();

  if (!video) {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }
  if (video.owner_id !== userData.user.id) {
    return NextResponse.json({ error: 'Tohle video není tvoje.' }, { status: 403 });
  }

  const result = await syncVideoProtection(videoId);
  return NextResponse.json(result);
}
