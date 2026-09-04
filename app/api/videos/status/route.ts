import { NextRequest, NextResponse } from 'next/server';
import { refreshFromCloudflare } from '@/lib/markVideoReady';

// Zeptá se Cloudflare Stream, jestli je video už zpracované, a pokud ano,
// aktualizuje záznam v naší databázi (status, náhledový obrázek, délka).
//
// Vlastní práce je v lib/markVideoReady.ts, protože na "video je hotové"
// vedou dvě cesty: tenhle dotaz a webhook od Cloudflare. Kdyby to bylo
// dvakrát opsané, dřív nebo později by se rozešly.
export async function POST(req: NextRequest) {
  const { videoId } = await req.json().catch(() => ({ videoId: null }));

  if (!videoId) {
    return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });
  }

  const vysledek = await refreshFromCloudflare(videoId);

  if (vysledek === 'not-found') {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }

  return NextResponse.json({ status: vysledek });
}
