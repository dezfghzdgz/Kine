import { NextRequest, NextResponse } from 'next/server';
import { supabaseAsUser, bearerFrom } from '@/lib/supabaseAsUser';
import { protectionConfigured, shouldBeProtected } from '@/lib/streamProtection';
import { createStreamToken, signingKeyFromEnv, PLAYBACK_TOKEN_TTL_S } from '@/lib/streamToken';

/**
 * Token na přehrání neveřejného videa (lib/streamProtection.ts).
 *
 * Prohlížeč sem přijde s id videa a se svým přihlášením. Kdo má video
 * podle databáze vidět (majitel, odběratel u videa pro odběratele,
 * spolutvůrce), dostane token na 4 hodiny; ostatní 403. Veřejné video
 * token nepotřebuje - odpověď je {token: null} a přehrávač použije id.
 *
 * Když podpisový klíč není nastavený, je odpověď vždy {token: null} a
 * appka se chová jako dřív.
 */
export async function POST(req: NextRequest) {
  const { videoId } = await req.json().catch(() => ({ videoId: null }));
  if (!videoId || typeof videoId !== 'string') {
    return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });
  }

  const key = signingKeyFromEnv();
  if (!key || !protectionConfigured()) {
    return NextResponse.json({ token: null, expiresAt: null, signed: false });
  }

  // Databáze rozhodne, jestli tenhle člověk video vidí (RLS) - stejnými
  // pravidly jako všude jinde v appce.
  const asUser = supabaseAsUser(bearerFrom(req));
  const { data: video, error } = await asUser
    .from('videos')
    .select('id, cloudflare_video_id, visibility')
    .eq('id', videoId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!video || !video.cloudflare_video_id) {
    return NextResponse.json({ error: 'Video nenalezeno nebo k němu nemáš přístup.' }, { status: 403 });
  }

  if (!shouldBeProtected(video.visibility)) {
    return NextResponse.json({ token: null, expiresAt: null, signed: false });
  }

  const now = Date.now();
  const token = createStreamToken(key, video.cloudflare_video_id, { ttlSeconds: PLAYBACK_TOKEN_TTL_S, now });
  return NextResponse.json({
    token,
    expiresAt: now + PLAYBACK_TOKEN_TTL_S * 1000,
    signed: true,
  });
}
