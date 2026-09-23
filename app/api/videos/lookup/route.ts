import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { refreshFromCloudflare, sweepProcessing } from '@/lib/markVideoReady';

// Záloha pro stránku /watch, když prohlížeč video přes RLS nevidí.
//
// Stránka si video normálně načte přímo z databáze (přes pravidla RLS).
// Když dotaz nic nevrátí, dřív se ukázalo jen "video neexistuje, nebo na
// něj nemáš přístup" s technickým detailem "Cannot coerce the result to a
// single JSON object" - a to i majiteli hned po nahrání (soukromé video,
// prohlížeč přihlášený jiným účtem nebo s vypršelou relací). Tady se
// server podívá, co se ve skutečnosti děje:
//
//  - video neexistuje                  -> { exists: false }
//  - majitel (podle přihlašovacího      -> { exists: true, owner: true, video }
//    tokenu)                               (celý záznam - stránka ho ukáže,
//                                           i když RLS z prohlížeče nešlo)
//  - kdokoli jiný                       -> { exists: true, owner: false,
//                                           visibility, status, signedIn }
//                                           (žádný obsah videa - jen proč
//                                           ho nevidí, ať se dá poradit)
//
// Veřejné video cizího tvůrce se tudy záměrně nevrací celé: kdyby ho
// prohlížeč neviděl, má to důvod (shadow ban, smazaný profil) a tahle
// cesta ho nemá obcházet.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const videoId = typeof body?.videoId === 'string' ? body.videoId.trim() : '';
  if (!UUID.test(videoId)) {
    return NextResponse.json({ error: 'Chybí nebo je špatné videoId.' }, { status: 400 });
  }

  let userId: string | null = null;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (token) {
    const { data } = await supabaseServer.auth.getUser(token);
    userId = data.user?.id ?? null;
  }

  const { data: video, error } = await supabaseServer
    .from('videos')
    .select('*, profiles!videos_owner_id_fkey(id, username, display_name, avatar_url, created_at, verification_tier)')
    .eq('id', videoId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!video) {
    return NextResponse.json({ exists: false }, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Video se ještě "zpracovává" - zeptat se Cloudflare rovnou (často je
  // dávno hotové, jen se nikdo nezeptal - typicky po nahrání z appky Kine
  // do PC), a při té příležitosti uklidit i další zaseklá.
  if (video.status && video.status !== 'ready') {
    try {
      if ((await refreshFromCloudflare(video.id)) === 'ready') video.status = 'ready';
    } catch {
      // Cloudflare neodpověděl - stránka si video ověří znovu za chvíli.
    }
    await sweepProcessing();
  }

  const owner = !!userId && video.owner_id === userId;
  if (owner) {
    return NextResponse.json({ exists: true, owner: true, video }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(
    { exists: true, owner: false, visibility: video.visibility ?? 'public', status: video.status ?? 'ready', signedIn: !!userId },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
