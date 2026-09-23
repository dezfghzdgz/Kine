import { NextRequest, NextResponse } from 'next/server';
import { sweepProcessing } from '@/lib/markVideoReady';

export const dynamic = 'force-dynamic';

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
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
