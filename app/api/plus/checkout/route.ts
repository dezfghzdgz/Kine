import { NextRequest, NextResponse } from 'next/server';
import { PAYMENTS_ENABLED, PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { hasPlus, isPaidTier, tierStripePriceId } from '@/lib/plus';
import { siteUrlFrom } from '@/lib/siteUrl';
import { checkoutTexts } from '@/lib/plusCheckout';
import { paymentAllowedNow, TEST_MODE_OFF } from '@/lib/paymentsServer';
import { stripeMissing } from '@/lib/stripeSetup';

/**
 * Koupě předplatného: založí u Stripe předplatné (Checkout) a pošle
 * uživatele na platební stránku. Tři varianty (lib/plus.ts), každá má
 * vlastní cenu ve Stripe: STRIPE_PLUS_KINE_PRICE_ID, STRIPE_PLUS_CLIPS_PRICE_ID,
 * STRIPE_PLUS_ALL_PRICE_ID (Stripe dashboard -> Product catalog -> cena, měsíční).
 *
 * Tělo: { tier: 'kine' | 'clips' | 'all', lang?: jazyk webu (texty na platební stránce) }
 *
 * Spotřebitel v EU může od smlouvy na dálku odstoupit do 14 dnů. Na platební
 * stránce proto zaškrtne, že chce předplatné hned (a při odstoupení zaplatí
 * poměrnou část) - souhlas Stripe uloží k platbě. Zaškrtávátko Stripe ukáže,
 * jen když je v jeho nastavení adresa podmínek (Settings -> Business ->
 * Public details -> Terms of service); bez ní je stejný text u tlačítka.
 *
 * Kdo už předplatné má, mění ho ve správě předplatného (portál Stripe) -
 * druhé předplatné se mu nezaloží. Výjimka: předplatné / zákazník ze
 * zkoušení plateb (testovací klíč), které u Stripe s ostrým klíčem není -
 * to nic neblokuje a platí se jako nový zákazník.
 *
 * S testovacím klíčem Stripe platí jen správce (lib/paymentsServer.ts).
 *
 * Že platba proběhla, se dozví až webhook (app/api/donate/webhook) - ten
 * nastaví plan. Stránka /plus?ok=1 je jen poděkování.
 */
export async function POST(req: NextRequest) {
  // Placení zatím neběží (lib/payments.ts) - nic se nezaplatí ani omylem.
  if (!PAYMENTS_ENABLED) return NextResponse.json(PAYMENTS_OFF, { status: 503 });
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (!(await paymentAllowedNow(userData.user.id))) return NextResponse.json(TEST_MODE_OFF, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const tier = isPaidTier(body?.tier) ? body.tier : 'all';
  const priceId = tierStripePriceId(tier);
  if (!priceId) {
    return NextResponse.json({ error: 'Tahle varianta předplatného se teprve připravuje.', code: 'not-configured' }, { status: 503 });
  }

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('plan, plan_until, plan_stripe_customer_id, plan_stripe_subscription_id')
    .eq('id', userData.user.id)
    .maybeSingle();

  let customerId: string | null = profile?.plan_stripe_customer_id ?? null;
  if (profile?.plan_stripe_subscription_id && hasPlus(profile.plan, profile.plan_until)) {
    // Je to předplatné u Stripe v tomhle režimu? Z testovacího režimu (po přechodu na ostrý klíč) není.
    const here = await stripeServer.subscriptions.retrieve(profile.plan_stripe_subscription_id).then(
      () => true,
      (e) => !stripeMissing(e)
    );
    if (here) {
      return NextResponse.json({ error: 'Předplatné už máš - změnit ho jde ve správě předplatného.', code: 'already-subscribed' }, { status: 409 });
    }
    customerId = null;
  }

  const siteUrl = siteUrlFrom(req);
  const userId = userData.user.id;

  const texts = checkoutTexts(body?.lang, siteUrl);
  const params: any = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    // Stejný zákazník u Stripe jako minule, ať se nemnoží.
    ...(customerId ? { customer: customerId } : { customer_email: userData.user.email ?? undefined }),
    subscription_data: { metadata: { kind: 'kine-plus', userId, tier } },
    metadata: { kind: 'kine-plus', userId, tier },
    allow_promotion_codes: true,
    // Managed Payments (Stripe jako prodejce) je na účtu zapnuté jako výchozí a nesnese
    // vlastní texty (souhlas s podmínkami) - Kine prodává samo, jako u darů a podpor.
    managed_payments: { enabled: false },
    locale: texts.locale,
    success_url: `${siteUrl}/plus?ok=1`,
    cancel_url: `${siteUrl}/plus`,
  };

  async function createSession(p: any) {
    try {
      // Zaškrtnutí podmínek + začátek hned (odstoupení do 14 dnů).
      return await stripeServer.checkout.sessions.create({
        ...p,
        consent_collection: { terms_of_service: 'required' },
        custom_text: { submit: { message: texts.renewal }, terms_of_service_acceptance: { message: texts.consent } },
      });
    } catch (e: any) {
      // Ve Stripe chybí adresa podmínek - zaplatit jde i tak, souhlas je pak v textu u tlačítka.
      if (!/terms of service|terms_of_service/i.test(String(e?.message ?? ''))) throw e;
      console.warn('Kine Plus: ve Stripe chybí adresa podmínek (Settings -> Business -> Public details) - platba bez zaškrtávátka');
      return await stripeServer.checkout.sessions.create({ ...p, custom_text: { submit: { message: `${texts.consentPlain} ${texts.renewal}` } } });
    }
  }


  try {
    let session;
    try {
      session = await createSession(params);
    } catch (e: any) {
      // Uložený zákazník u Stripe v tomhle režimu není (ze zkoušení plateb) - nový podle e-mailu.
      if (!params.customer || !stripeMissing(e, 'customer')) throw e;
      const fresh = { ...params, customer_email: userData.user.email ?? undefined };
      delete fresh.customer;
      session = await createSession(fresh);
    }
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Stripe se nepodařilo zavolat.' }, { status: 502 });
  }
}
