import { NextRequest, NextResponse } from 'next/server';
import { PAYMENTS_ENABLED } from '@/lib/payments';
import { supabaseServer } from '@/lib/supabaseServer';
import { allPriceLabels, anyTierAvailable, hasClipsPlus, hasKinePlus, normalizePlan, FREE_CLIP_MAX_SECONDS, PLUS_CLIP_MAX_SECONDS } from '@/lib/plus';
import { sweepProcessing } from '@/lib/markVideoReady';
import { outdatedAppResponse } from '@/lib/desktopGate';
import { generatedUsername } from '@/lib/ensureProfile';

export const dynamic = 'force-dynamic';

/**
 * Kdo jsem a co smím - pro appku Kine do PC.
 *
 * Vrací jméno, plán (free / kine / clips / all) a z něj odvozené clipsPlus
 * (automatické nahrávání, dlouhé klipy) a kinePlus (web), barvu Kine,
 * kterou má hráč nastavenou u loga (appka se do ní obarví), strop délky
 * klipu a ceny variant. Appka se ptá při startu a pak občas; když
 * předplatné vyprší, samo přepne automatické nahrávání zpátky na ruční.
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  // Sloupce plánu přišly migrací supabase-migration-kine-plus.sql; kdyby
  // ještě neproběhla, appka běží jako základní verze.
  let profile: any = null;
  const full = await supabaseServer
    .from('profiles')
    .select('username, display_name, brand_color, plan, plan_until')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (full.error) {
    const basic = await supabaseServer.from('profiles').select('username, display_name, brand_color').eq('id', userData.user.id).maybeSingle();
    profile = basic.data;
  } else {
    profile = full.data;
  }

  // Zastaralá appka (lib/desktopGate.ts) nedostane nic placeného - jen základ, dokud se neaktualizuje.
  const outdated = (await outdatedAppResponse(req)) !== null;
  const clipsPlus = !outdated && hasClipsPlus(profile?.plan, profile?.plan_until);
  const kinePlus = !outdated && hasKinePlus(profile?.plan, profile?.plan_until);
  // Placení zatím neběží (lib/payments.ts): nic se nedá koupit - appka místo odkazu ukáže "Připravujeme".
  const prices = PAYMENTS_ENABLED ? allPriceLabels() : { kine: null, clips: null, all: null };
  // Appka se ptá při startu a občas - dobrá chvíle dodělat videa, která
  // po nahrání z appky zůstala viset jako "processing" (viz markVideoReady).
  await sweepProcessing();
  return NextResponse.json({
    id: userData.user.id,
    // Bez profilu náhradní jméno z id - nikdy kus e-mailu (lib/ensureProfile.ts).
    username: profile?.username ?? generatedUsername(userData.user.id),
    displayName: profile?.display_name ?? null,
    brandColor: typeof profile?.brand_color === 'string' ? profile.brand_color : null,
    plan: clipsPlus || kinePlus ? normalizePlan(profile?.plan) : 'free',
    planUntil: profile?.plan_until ?? null,
    clipsPlus,
    kinePlus,
    maxClipSeconds: clipsPlus ? PLUS_CLIP_MAX_SECONDS : FREE_CLIP_MAX_SECONDS,
    /** Dá se něco koupit? (je nastavená aspoň jedna cena u Stripe) */
    plusAvailable: PAYMENTS_ENABLED && anyTierAvailable(),
    prices,
    /** Starší appky: cena "Plus" = varianta s klipy. */
    plusPriceLabel: prices.clips ?? prices.all,
    /** Appka je moc stará - má se aktualizovat (nahrávat a vysílat nepůjde). */
    updateRequired: outdated,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
