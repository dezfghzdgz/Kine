import { NextRequest, NextResponse } from 'next/server';
import { PAYMENTS_ENABLED } from '@/lib/payments';
import { PAID_TIERS } from '@/lib/plus';
import { getPlusPrices, shownCurrencyFor } from '@/lib/plusPrices';

export const dynamic = 'force-dynamic';

/**
 * Ceny předplatného pro stránku /plus - rovnou ze Stripe (lib/plusPrices.ts),
 * jen v eurech a dolarech. Měna podle země návštěvníka (Vercel ji pozná
 * z IP): v USA dolary, jinde eura - stejně jako potom na platební stránce.
 *
 * Odpověď: { enabled, ok, currency: 'eur'|'usd', tiers: { kine: { eur, usd } | null, ... } }
 * (částky v setinách; null = varianta se zatím neprodává). Nic tajného.
 */
export async function GET(req: NextRequest) {
  if (!PAYMENTS_ENABLED) return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  const live = await getPlusPrices();
  const tiers = Object.fromEntries(PAID_TIERS.map((tier) => [tier, live.tiers[tier]?.amounts ?? null]));
  return NextResponse.json(
    { enabled: true, ok: live.ok, currency: shownCurrencyFor(req.headers.get('x-vercel-ip-country')), tiers },
    // Liší se podle země - jen do prohlížeče, ne do sdílené mezipaměti.
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}
