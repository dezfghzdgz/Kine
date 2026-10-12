import { NextRequest, NextResponse } from 'next/server';
import { sweepProcessing } from '@/lib/markVideoReady';
import { sweepNudity } from '@/lib/nudityScan';

export const dynamic = 'force-dynamic';
// Kontrola obsahu starších videí potřebuje pár desítek sekund (model běží na procesoru).
export const maxDuration = 60;

/**
 * Úklid zaseklých videí na zavolání (viz lib/markVideoReady.ts,
 * sweepProcessing). Pouští ho denně cron z vercel.json a jde ho zavolat
 * i ručně: otevřít /api/videos/sweep v prohlížeči.
 *
 * Když je na Vercelu nastavená proměnná CRON_SECRET, Vercel ji posílá
 * v hlavičce Authorization a cizí volání se odmítne. Bez ní je cesta
 * otevřená - nic škodlivého se tudy udělat nedá (jen se Cloudflare zeptá
 * na pár videí), a víc než jednou za minutu a půl to stejně nic nedělá.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 401 });
  }
  const result = await sweepProcessing({ max: 25, force: true });
  // Nezkontrolovaná videa (nahraná před zapnutím kontroly nahoty) - po pár kouscích.
  // Bez ověřeného cronu nejvýš jednou za 5 minut, ať se tudy nedá pálit výkon serveru.
  const nudityChecked = await sweepNudity({ max: 6, budgetMs: 40_000, force: !!secret }).catch(() => 0);
  return NextResponse.json({ ...result, nudityChecked }, { headers: { 'Cache-Control': 'no-store' } });
}
