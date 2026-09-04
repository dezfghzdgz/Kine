import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { RESUMABLE_FROM_BYTES, base64Ascii } from '@/lib/tusUpload';

/** Strop délky videa, který si u Cloudflare rezervujeme (6 hodin). */
const MAX_DURATION_SECONDS = 21600;

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

  // Velikost souboru posílá prohlížeč. Podle ní se pozná, jestli stačí
  // jeden požadavek, nebo se musí nahrávat po částech.
  let fileSize = 0;
  try {
    const body = await req.json();
    fileSize = Number(body?.fileSize) || 0;
  } catch {
    // Starší verze stránky velikost neposílala - pak se jede jako dřív.
  }

  if (fileSize > RESUMABLE_FROM_BYTES) {
    return createResumableUpload(accountId, apiToken, fileSize);
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
        maxDurationSeconds: MAX_DURATION_SECONDS,
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
    mode: 'basic',
    uploadURL: data.result.uploadURL,
    videoId: data.result.uid,
  });
}

/**
 * Založí nahrávání po částech (protokol tus).
 *
 * Cloudflare přijme jedním obyčejným požadavkem nejvýš 200 MB. Větší
 * soubor odmítne uprostřed nahrávání - a protože odmítnutá odpověď
 * nenese hlavičky pro cizí doménu, prohlížeč z ní nic nepřečte a ohlásí
 * jen "chyba sítě". Proto delší videa vždycky spadla někde v půlce a
 * vypadalo to jako výpadek připojení, i když připojení bylo v pořádku.
 *
 * "direct_user=true" znamená, že vrácená adresa je jednorázová a smí do
 * ní posílat i prohlížeč bez našeho klíče - klíč tedy neopouští server.
 */
async function createResumableUpload(accountId: string, apiToken: string, fileSize: number) {
  // Hodnoty v Upload-Metadata se podle protokolu posílají v base64.
  const metadata = `maxDurationSeconds ${base64Ascii(String(MAX_DURATION_SECONDS))}`;

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSize),
        'Upload-Metadata': metadata,
      },
    }
  );

  const uploadURL = response.headers.get('Location');
  const videoId = response.headers.get('stream-media-id');

  if (!response.ok || !uploadURL || !videoId) {
    const detail = await response.text().catch(() => '');
    return NextResponse.json(
      { error: 'Cloudflare nepřijal nahrávání po částech.', details: detail.slice(0, 500) },
      { status: 500 }
    );
  }

  return NextResponse.json({ mode: 'tus', uploadURL, videoId });
}
