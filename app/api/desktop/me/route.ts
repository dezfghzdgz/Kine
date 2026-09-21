import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { allPriceLabels, anyTierAvailable, hasClipsPlus, hasKinePlus, normalizePlan, FREE_CLIP_MAX_SECONDS, PLUS_CLIP_MAX_SECONDS } from '@/lib/plus';

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

  const clipsPlus = hasClipsPlus(profile?.plan, profile?.plan_until);
  const kinePlus = hasKinePlus(profile?.plan, profile?.plan_until);
  const prices = allPriceLabels();
  return NextResponse.json({
    id: userData.user.id,
    username: profile?.username ?? userData.user.email?.split('@')[0] ?? 'kine',
    displayName: profile?.display_name ?? null,
    brandColor: typeof profile?.brand_color === 'string' ? profile.brand_color : null,
    plan: clipsPlus || kinePlus ? normalizePlan(profile?.plan) : 'free',
    planUntil: profile?.plan_until ?? null,
    clipsPlus,
    kinePlus,
    maxClipSeconds: clipsPlus ? PLUS_CLIP_MAX_SECONDS : FREE_CLIP_MAX_SECONDS,
    /** Dá se něco koupit? (je nastavená aspoň jedna cena u Stripe) */
    plusAvailable: anyTierAvailable(),
    prices,
    /** Starší appky: cena "Plus" = varianta s klipy. */
    plusPriceLabel: prices.clips ?? prices.all,
  });
}
