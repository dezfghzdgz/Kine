import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { autoCaptionLanguage } from '@/lib/captions';
import { generateCaptions, generatedCaptions } from '@/lib/autoCaptions';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * Automatické titulky na požádání (úpravy videa): "generate" o ně požádá
 * Cloudflare, "status" vrátí stav a hotové titulky. Uloží je až tvůrce
 * spolu s ostatními úpravami - může je předtím opravit.
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const videoId = String(body?.videoId ?? '');
  const action = String(body?.action ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(videoId) || (action !== 'generate' && action !== 'status')) {
    return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  }
  // Generování: pár za hodinu (každé je práce u Cloudflare); stav: stránka se ptá co 5 s.
  const allowed = action === 'generate' ? allowRequest(`captions-gen:${user.id}`, 6, 60 * 60 * 1000) : allowRequest(`captions-status:${user.id}`, 30, 60 * 1000);
  if (!allowed) return tooManyRequests(action === 'generate' ? 600 : 15);

  const { data: video } = await supabaseServer
    .from('videos')
    .select('id, owner_id, cloudflare_video_id, language, status, duration_seconds')
    .eq('id', videoId)
    .maybeSingle();
  if (!video || video.owner_id !== user.id) return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  if (video.status !== 'ready') return NextResponse.json({ error: 'Video se ještě zpracovává.' }, { status: 409 });

  const language = autoCaptionLanguage(typeof body?.language === 'string' ? body.language : video.language);
  if (!language) return NextResponse.json({ error: 'unsupported-language' }, { status: 422 });

  try {
    if (action === 'generate') {
      await generateCaptions(video.cloudflare_video_id, language);
      return NextResponse.json({ status: 'inprogress', language });
    }
    const state = await generatedCaptions(video.cloudflare_video_id, language);
    return NextResponse.json({ ...state, language });
  } catch (e) {
    console.error('Kine: automatické titulky -', (e as Error).message);
    return NextResponse.json({ status: 'error' }, { status: 502 });
  }
}
