import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { refreshFromCloudflare, sweepProcessing } from '@/lib/markVideoReady';
import { runInBackground } from '@/lib/background';
import { videoRefFrom } from '@/lib/videoRef';

// Na pozadí může běžet kontrola obsahu (lib/nudityScan.ts) - funkce smí doběhnout až minutu.
export const maxDuration = 60;

// Zeptá se Cloudflare Stream, jestli je video už zpracované, a pokud ano,
// aktualizuje záznam v naší databázi (status, náhledový obrázek, délka).
//
// Vlastní práce je v lib/markVideoReady.ts, protože na "video je hotové"
// vedou dvě cesty: tenhle dotaz a webhook od Cloudflare. Kdyby to bylo
// dvakrát opsané, dřív nebo později by se rozešly.
//
// videoId = id videa na Kine, nebo id u Cloudflare (lib/videoRef.ts):
// mobilní Kine Clipper do 0.4.1 posílal to od Cloudflare - Kine video
// nenašla, nikdo ho nepřepnul na hotové a na Kine nebylo vidět. V odpovědi
// je i "id" na Kine, ať se ho appka dozví.
export async function POST(req: NextRequest) {
  const { videoId } = await req.json().catch(() => ({ videoId: null }));

  if (!videoId) {
    return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });
  }

  // Neznámý tvar id = video nenalezeno (jako dřív) - do databáze se nic takového neposílá.
  const ref = videoRefFrom(videoId);
  let kineId: string | null = ref?.kind === 'kine' ? ref.id : null;
  if (ref?.kind === 'cloudflare') {
    const { data, error } = await supabaseServer.from('videos').select('id').eq('cloudflare_video_id', ref.uid).limit(1);
    // Výpadek databáze: ať se appka zeptá znovu (ne "nenalezeno").
    if (error) return NextResponse.json({ error: 'Kine teď neodpovídá - zkus to za chvíli.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    kineId = (data as { id: string }[] | null)?.[0]?.id ?? null;
  }

  const prubeh = { percent: null as number | null };
  const vysledek = kineId ? await refreshFromCloudflare(kineId, prubeh) : 'not-found';

  // Když se už někdo ptá, projdou se při té příležitosti i ostatní zaseklá
  // videa (nejvýš jednou za minutu a půl; viz sweepProcessing) - na pozadí,
  // ať odpověď nečeká na dotazy u Cloudflare za cizí videa.
  runInBackground(sweepProcessing(), 'úklid zaseklých videí');

  if (vysledek === 'not-found') {
    return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });
  }

  // percent: jak daleko je zpracování u Cloudflare (jen během zpracování, když to Cloudflare ví).
  return NextResponse.json(
    vysledek === 'processing' && prubeh.percent !== null ? { status: vysledek, percent: prubeh.percent, id: kineId } : { status: vysledek, id: kineId },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
