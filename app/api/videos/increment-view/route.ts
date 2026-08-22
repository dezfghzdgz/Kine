import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

const COOLDOWN_MS = 30 * 60 * 1000; // 30 minut

// Zvýší počet zhlédnutí. Předtím appka tohle chránila jen v prohlížeči
// (localStorage) - to jde snadno obejít (appku zavolat rovnou, nebo
// localStorage smazat). Appka teď navíc hlídá IP adresu, ať pozná
// opakované počítání odjinud ze stejného místa i tehdy, kdyby appce
// klient neposlal pravdivý stav svého localStorage.
/**
 * Zdroj zhlédnutí ukládáme jen jako krátký očištěný název místa nebo domény.
 * Cokoliv jiného appka zahodí - do databáze nesmí přistát libovolný text,
 * který si klient vymyslí.
 */
function sanitizeSource(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const clean = value.trim().toLowerCase().slice(0, 60);
  return /^[a-z0-9.-]+$/.test(clean) ? clean : 'unknown';
}

export async function POST(req: NextRequest) {
  const { videoId, source } = await req.json();
  if (!videoId) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  const { data: video } = await supabaseServer.from('videos').select('views').eq('id', videoId).single();
  if (!video) return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  const cooldownStart = new Date(Date.now() - COOLDOWN_MS).toISOString();

  const { data: recentView } = await supabaseServer
    .from('views_log')
    .select('id')
    .eq('video_id', videoId)
    .eq('ip_address', ip)
    .gte('viewed_at', cooldownStart)
    .limit(1)
    .maybeSingle();

  if (recentView) {
    // Appka tohle zhlédnutí odsud a od tohohle videa už nedávno počítala.
    return NextResponse.json({ success: true, counted: false });
  }

  await supabaseServer.from('videos').update({ views: (video.views ?? 0) + 1 }).eq('id', videoId);

  const { error: logError } = await supabaseServer
    .from('views_log')
    .insert({ video_id: videoId, ip_address: ip, source: sanitizeSource(source) });

  // Sloupec "source" přidává samostatná migrace. Když ještě neproběhla,
  // zhlédnutí se nesmí ztratit - appka ho zapíše aspoň bez zdroje.
  if (logError) {
    await supabaseServer.from('views_log').insert({ video_id: videoId, ip_address: ip });
  }

  return NextResponse.json({ success: true, counted: true });
}
