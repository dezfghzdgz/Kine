import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Trvale smaže účet uživatele: jeho videa z Cloudflare Stream, a poté
// samotný přihlašovací účet - díky "on delete cascade" v databázi se tím
// smaže i všechno ostatní (komentáře, playlisty, příspěvky, odběry...).
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

  const userId = userData.user.id;

  const { data: videos } = await supabaseServer
    .from('videos')
    .select('cloudflare_video_id')
    .eq('owner_id', userId);

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

  await Promise.all(
    (videos ?? []).map((v) =>
      fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${v.cloudflare_video_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } }
      ).catch(() => null)
    )
  );

  const { error: deleteError } = await supabaseServer.auth.admin.deleteUser(userId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
