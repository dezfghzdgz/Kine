import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

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

  return NextResponse.json({
    status: mp4?.status ?? 'processing',
    url: mp4?.url ?? null,
  });
}
