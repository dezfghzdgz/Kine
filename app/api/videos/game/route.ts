import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { userFromRequest } from '@/lib/apiUser';
import { allowRequest, tooManyRequests } from '@/lib/rateLimit';
import { GAMING_CATEGORY, gameFromHashtags, isGameSlug, replaceGameTag } from '@/lib/games';

export const dynamic = 'force-dynamic';

/**
 * Hra u hotového videa (úprava videa - components ve your-videos/[id]/edit).
 * Hashtagy z prohlížeče měnit nejdou (sloupce povolené k úpravě jsou jen
 * název, popis, náhled...), takže hru mění server: odebere hashtagy dosavadní
 * hry a přidá hlavní hashtag nové (lib/games.ts - replaceGameTag). Jen
 * vlastník videa a jen u kategorie Hry.
 *
 * POST { videoId, game: slug | null } -> { game, hashtags }
 */
export async function POST(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!allowRequest(`video-game:${user.id}`, 20, 60 * 1000)) return tooManyRequests(20);

  const body = await req.json().catch(() => ({}));
  const videoId = typeof body?.videoId === 'string' ? body.videoId : '';
  if (!/^[0-9a-f-]{36}$/i.test(videoId)) return NextResponse.json({ error: 'Chybí id videa.' }, { status: 400 });
  const game = body?.game === null || body?.game === '' ? null : body?.game;
  if (game !== null && !isGameSlug(game)) return NextResponse.json({ error: 'Neznámá hra.' }, { status: 400 });

  const { data: video, error } = await supabaseServer.from('videos').select('id, owner_id, category, hashtags').eq('id', videoId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Video se teď nepodařilo načíst.' }, { status: 503 });
  if (!video || video.owner_id !== user.id) return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  if (video.category !== GAMING_CATEGORY && game !== null) {
    return NextResponse.json({ error: 'Hra jde vybrat jen u videa v kategorii Hry.' }, { status: 400 });
  }

  const hashtags = replaceGameTag(video.hashtags, video.category, game);
  const same = JSON.stringify(hashtags) === JSON.stringify(video.hashtags ?? []);
  if (!same) {
    const { error: updateError } = await supabaseServer.from('videos').update({ hashtags }).eq('id', videoId).eq('owner_id', user.id);
    if (updateError) return NextResponse.json({ error: 'Hru se nepodařilo uložit.' }, { status: 500 });
  }
  return NextResponse.json({ game: gameFromHashtags(hashtags, video.category)?.slug ?? null, hashtags });
}
