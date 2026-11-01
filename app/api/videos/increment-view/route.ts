import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { sanitizeDeviceClass } from '@/lib/deviceClass';
import { clientIp } from '@/lib/clientIp';

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

/**
 * Kulaté počty zhlédnutí, u kterých má smysl tvůrce upozornit.
 *
 * Do stovky po malých krocích (ať má radost i malý kanál), pak už jen
 * desetinásobky - jinak by u velkého videa přišlo oznámení každou chvíli.
 */
function isViewMilestone(views: number): boolean {
  const smallMilestones = [10, 25, 50, 100, 250, 500];
  if (smallMilestones.includes(views)) return true;
  if (views < 1000) return false;

  // 1 000, 5 000, 10 000, 50 000, 100 000, ...
  for (let step = 1000; step <= 1_000_000_000; step *= 10) {
    if (views === step || views === step * 5) return true;
  }
  return false;
}

/** Který sloupec v tabulce chybí (starší databáze bez migrace) - z hlášky Supabase / Postgresu. */
function missingColumn(message: string | undefined): string | null {
  const text = message ?? '';
  const m = /Could not find the '([a-z_]+)' column/i.exec(text) ?? /column "?(?:[a-z_]+\.)?([a-z_]+)"? (?:of relation "[a-z_]+" )?does not exist/i.exec(text);
  return m ? m[1] : null;
}

/**
 * Zápis zhlédnutí. Sloupce ip_address, source a device přidávaly samostatné
 * migrace - když některá neproběhla, zapíše se zhlédnutí bez toho sloupce
 * (dřív se bez ip_address nezapsalo vůbec a statistiky kanálu byly prázdné).
 */
async function logView(row: Record<string, unknown>): Promise<void> {
  const current: Record<string, unknown> = { ...row };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await supabaseServer.from('views_log').insert(current);
    if (!error) return;
    const column = missingColumn(error.message);
    if (!column || column === 'video_id' || !(column in current)) return;
    delete current[column];
  }
}

export async function POST(req: NextRequest) {
  const { videoId, source, device } = await req.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof videoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(videoId)) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  const { data: video } = await supabaseServer
    .from('videos')
    .select('views, title, owner_id')
    .eq('id', videoId)
    .single();
  if (!video) return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });

  // IP od Vercelu, ne z hlavičky, kterou si klient může poslat sám (lib/clientIp.ts).
  const ip = clientIp(req.headers);
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

  // Přičtení řeší funkce v databázi, aby se souběžná zhlédnutí nepřebíjela
  // (dva diváci naráz by jinak přečetli stejné číslo a jedno by se ztratilo).
  // Dokud neproběhne migrace, appka spadne zpátky na starý způsob.
  const { data: incremented, error: incrementError } = await supabaseServer
    .rpc('increment_video_views', { target_video_id: videoId });

  let newViews: number;
  if (incrementError || typeof incremented !== 'number') {
    newViews = (video.views ?? 0) + 1;
    await supabaseServer.from('videos').update({ views: newViews }).eq('id', videoId);
  } else {
    newViews = incremented;
  }

  // Milník zhlédnutí - tvůrce se dozví, že video přeskočilo kulaté číslo.
  // Jen na vybraných číslech, ať mu appka nechrlí oznámení u každého kliku.
  if (video.owner_id && isViewMilestone(newViews)) {
    await supabaseServer.from('notifications').insert({
      user_id: video.owner_id,
      type: 'view_milestone',
      message: `Tvoje video "${video.title}" má ${newViews} zhlédnutí!`,
      link: `/watch/${videoId}`,
    });
  }

  // Zařízení (telefon / tablet / počítač / TV) - jen jedna ze čtyř hodnot,
  // cokoliv jiného se zahodí (lib/deviceClass.ts).
  await logView({ video_id: videoId, ip_address: ip, source: sanitizeSource(source), device: sanitizeDeviceClass(device) });

  return NextResponse.json({ success: true, counted: true });
}
