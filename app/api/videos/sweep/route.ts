import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { sweepProcessing } from '@/lib/markVideoReady';
import { sweepNudity } from '@/lib/nudityScan';
import { costAlertCheck } from '@/lib/costs';
import { sweepLiveExtras } from '@/lib/liveScheduleServer';
import { sweepMaintenance } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';
// Kontrola obsahu starších videí potřebuje pár desítek sekund (model běží na procesoru).
export const maxDuration = 60;

/** Bez CRON_SECRET jde důkladný úklid spustit nejvýš jednou za hodinu. */
const OPEN_FORCE_EVERY_MS = 60 * 60 * 1000;
let lastOpenForce = 0;

/**
 * Důkladný úklid bez CRON_SECRET: jednou za hodinu pro celý web, ne na instanci
 * serveru. Dřív stačilo poslat víc požadavků naráz - každá nová instance Vercelu
 * pustila vlastní důkladný úklid (stovky dotazů na Cloudflare API, jehož limit
 * platí pro celý účet). Značka hodiny se zapíše do tabulky zámků (kine_user_locks);
 * kdo ji zapíše první, uklízí. null = tabulka není (migrace) - pak postaru na instanci.
 */
async function claimOpenForce(now: number): Promise<boolean | null> {
  const key = `sweep-force:${new Date(now).toISOString().slice(0, 13)}`;
  const { error } = await supabaseServer.from('kine_user_locks').insert({ key });
  if (!error) {
    // Značky starších hodin pryč (jen tyhle - zámky uživatelů se nemažou).
    await supabaseServer
      .from('kine_user_locks')
      .delete()
      .like('key', 'sweep-force:%')
      .lt('locked_at', new Date(now - 3 * OPEN_FORCE_EVERY_MS).toISOString())
      .then(
        () => undefined,
        () => undefined
      );
    return true;
  }
  if (error.code === '23505') return false;
  return null;
}

/**
 * Úklid na zavolání (viz lib/markVideoReady.ts, sweepProcessing): zaseklá
 * videa, nedokončená nahrávání, fronta mazání u Cloudflare, limity vysílání,
 * staré nezveřejněné záznamy, kontrola nákladů (lib/costs.ts), staré plány / ankety vysílání,
 * kvalita videí pro doporučování a úklid starých IP adres (lib/maintenance.ts). Pouští ho denně cron z vercel.json a jde
 * ho zavolat i ručně: otevřít /api/videos/sweep v prohlížeči.
 *
 * Když je na Vercelu nastavená proměnná CRON_SECRET, Vercel ji posílá
 * v hlavičce Authorization a cizí volání se odmítne. Bez ní je cesta
 * otevřená, ale důkladný úklid (ptá se Cloudflare na víc věcí) proběhne
 * nejvýš jednou za hodinu - jinak by se tudy dal vyčerpat limit API Cloudflare.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 401 });
  }
  let force = !!secret;
  if (!secret && Date.now() - lastOpenForce > OPEN_FORCE_EVERY_MS) {
    lastOpenForce = Date.now();
    const claimed = await claimOpenForce(Date.now());
    force = claimed !== false;
  }
  const started = Date.now();
  const result = await sweepProcessing({ max: 25, force });
  // Hlídač nákladů (lib/costs.ts): když něco hoří, správce dostane oznámení - jen při důkladném úklidu.
  // Před kontrolou obsahu, ať na něj vždycky dojde čas.
  const costAlerts = force ? await costAlertCheck().catch(() => 0) : 0;
  // Propadlé plány vysílání, staré ankety, raidy a připomenutí (lib/liveScheduleServer.ts).
  if (force) await sweepLiveExtras().catch(() => undefined);
  // Kvalita videí pro doporučování a úklid osobních údajů (lib/maintenance.ts).
  const maintenance = force ? await sweepMaintenance().catch(() => null) : null;
  // Nezkontrolovaná videa (nahraná před zapnutím kontroly nahoty) - po pár kouscích, jen do zbytku
  // času funkce (60 s). Bez ověřeného cronu nejvýš jednou za 5 minut, ať se tudy nedá pálit výkon serveru.
  const left = Math.max(5_000, Math.min(40_000, 50_000 - (Date.now() - started)));
  const nudityChecked = await sweepNudity({ max: 6, budgetMs: left, force: !!secret }).catch(() => 0);
  return NextResponse.json({ ...result, nudityChecked, costAlerts, maintenance }, { headers: { 'Cache-Control': 'no-store' } });
}
