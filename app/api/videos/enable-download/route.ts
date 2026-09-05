import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { supabaseAsUser } from '@/lib/supabaseAsUser';
import { protectionConfigured, shouldBeProtected } from '@/lib/streamProtection';
import { createStreamToken, signingKeyFromEnv, swapPlaybackId, DOWNLOAD_TOKEN_TTL_S } from '@/lib/streamToken';

// Cloudflare Stream negeneruje MP4 ke stažení automaticky - musí se o něj
// zvlášť požádat. První požadavek spustí generování (chvíli trvá), další
// požadavky už jen ověří, jestli je hotové.
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

  const { cloudflareVideoId } = await req.json();
  if (!cloudflareVideoId || typeof cloudflareVideoId !== 'string') {
    return NextResponse.json({ error: 'Chybí id videa.' }, { status: 400 });
  }

  // Stáhnout smí jen ten, kdo video vidí - rozhodne databáze (RLS) stejně
  // jako u přehrávání. Dřív tu žádná kontrola nebyla: kdo znal id, stáhl
  // i cizí soukromé video.
  const { data: video } = await supabaseAsUser(token)
    .from('videos')
    .select('id, visibility')
    .eq('cloudflare_video_id', cloudflareVideoId)
    .maybeSingle();

  if (!video) {
    return NextResponse.json({ error: 'Video nenalezeno nebo k němu nemáš přístup.' }, { status: 403 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${cloudflareVideoId}/downloads`,
    { method: 'POST', headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const data = await res.json();

  if (!data.success) {
    return NextResponse.json({ error: 'Cloudflare odmítl povolit stažení.', details: data.errors }, { status: 500 });
  }

  const mp4 = data.result?.default;
  let url: string | null = mp4?.url ?? null;

  // Chráněné video (lib/streamProtection.ts): adresa ke stažení potřebuje
  // token s právem stahovat, jinak ji Cloudflare odmítne.
  const key = signingKeyFromEnv();
  if (url && key && protectionConfigured() && shouldBeProtected(video.visibility)) {
    const downloadToken = createStreamToken(key, cloudflareVideoId, {
      ttlSeconds: DOWNLOAD_TOKEN_TTL_S,
      downloadable: true,
    });
    url = swapPlaybackId(url, downloadToken) ?? url;
  }

  return NextResponse.json({
    status: mp4?.status ?? 'processing',
    url,
  });
}
