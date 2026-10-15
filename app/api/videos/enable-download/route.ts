import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { supabaseAsUser } from '@/lib/supabaseAsUser';
import { protectionConfigured, shouldBeProtected } from '@/lib/streamProtection';
import { createStreamToken, signingKeyFromEnv, swapPlaybackId, DOWNLOAD_TOKEN_TTL_S } from '@/lib/streamToken';
import { isCloudflareUid, streamApiUrl } from '@/lib/cloudflareVideos';

export const dynamic = 'force-dynamic';

/** Kolik různých cizích videí jde stáhnout za 24 hodin (každé stažení se u Cloudflare platí). */
const DOWNLOADS_PER_DAY = Math.max(1, Number(process.env.DOWNLOADS_PER_DAY) || 30);

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

  const body = await req.json().catch(() => ({}));
  const cloudflareVideoId = body?.cloudflareVideoId;
  if (!isCloudflareUid(cloudflareVideoId)) {
    return NextResponse.json({ error: 'Chybí id videa.' }, { status: 400 });
  }

  // Stáhnout smí jen ten, kdo video vidí - rozhodne databáze (RLS) stejně
  // jako u přehrávání. Dřív tu žádná kontrola nebyla: kdo znal id, stáhl
  // i cizí soukromé video.
  const { data: video } = await supabaseAsUser(token)
    .from('videos')
    .select('id, visibility, owner_id')
    .eq('cloudflare_video_id', cloudflareVideoId)
    .maybeSingle();

  if (!video) {
    return NextResponse.json({ error: 'Video nenalezeno nebo k němu nemáš přístup.' }, { status: 403 });
  }

  // Každé stažení Cloudflare účtuje jako přehrání celého videa - nejvýš
  // DOWNLOADS_PER_DAY různých videí za 24 hodin (vlastní videa se nepočítají).
  if (video.owner_id !== userData.user.id) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent, error: recentError } = await supabaseServer
      .from('downloads')
      .select('video_id')
      .eq('user_id', userData.user.id)
      .gte('downloaded_at', since)
      .limit(DOWNLOADS_PER_DAY + 1);
    const rows = (recent ?? []) as { video_id: string }[];
    if (!recentError && rows.length >= DOWNLOADS_PER_DAY && !rows.some((r) => r.video_id === video.id)) {
      return NextResponse.json({ error: `Za 24 hodin jde stáhnout nejvýš ${DOWNLOADS_PER_DAY} videí. Zkus to prosím později.`, code: 'limit' }, { status: 429 });
    }
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  if (!accountId || !apiToken) return NextResponse.json({ error: 'Cloudflare Stream není nakonfigurovaný.' }, { status: 500 });

  const res = await fetch(streamApiUrl(accountId, `/${encodeURIComponent(cloudflareVideoId)}/downloads`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({ success: false }));

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

  // Do historie stažení zapíše i server (strop za den se počítá odsud - prohlížeč by zápis mohl vynechat).
  if (mp4?.status === 'ready' && url) {
    await supabaseServer
      .from('downloads')
      .upsert({ user_id: userData.user.id, video_id: video.id, downloaded_at: new Date().toISOString() }, { onConflict: 'user_id,video_id' })
      .then(
        () => undefined,
        () => undefined
      );
  }

  return NextResponse.json({
    status: mp4?.status ?? 'processing',
    url,
  });
}
