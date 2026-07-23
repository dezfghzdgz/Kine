import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// Tenhle endpoint požádá Cloudflare Stream o jednorázovou "upload URL".
// Prohlížeč pak nahraje video přímo do Cloudflare (ne přes náš server),
// což šetří naši šířku pásma a je to rychlejší pro uživatele.
export async function POST(req: NextRequest) {
  // Bezpečnostní kontrola: bez tohohle by mohl upload URL získat kdokoliv,
  // i bez účtu, a nahrávat na náš Cloudflare účet (a tím nás to stálo peníze).
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;

  if (!accountId || !apiToken) {
    return NextResponse.json(
      { error: 'Cloudflare Stream není nakonfigurovaný na serveru.' },
      { status: 500 }
    );
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/direct_upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        maxDurationSeconds: 3600,
        requireSignedURLs: false,
      }),
    }
  );

  const data = await response.json();

  if (!data.success) {
    return NextResponse.json(
      { error: 'Cloudflare odmítl vytvořit upload URL.', details: data.errors },
      { status: 500 }
    );
  }

  return NextResponse.json({
    uploadURL: data.result.uploadURL,
    videoId: data.result.uid,
  });
}
