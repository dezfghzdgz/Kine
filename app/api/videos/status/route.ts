import { NextRequest, NextResponse } from 'next/server';
import { refreshFromCloudflare, sweepProcessing } from '@/lib/markVideoReady';

// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

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

  // Když se už někdo ptá, projdou se při té příležitosti i ostatní zaseklá
  // videa (nejvýš jednou za minutu a půl; viz sweepProcessing).
  await sweepProcessing();

  if (vysledek === 'not-found') {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }

  return NextResponse.json({ status: vysledek });
}
