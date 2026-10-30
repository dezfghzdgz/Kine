import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { tierFromStripePriceId } from '@/lib/plus';
import { plusFromSubscription, subscriptionIdFromCharge } from '@/lib/plusBilling';
import { supabaseServer } from '@/lib/supabaseServer';
import { recordLiveTip } from '@/lib/liveTipsServer';

// Appka poslouchá na "checkout.session.completed" - to je jediná chvíle,
// kdy appka může s jistotou vědět, že platba opravdu proběhla (nestačí
// jen appce věřit, že se úspěšně vrátil na "thank-you" stránku - to jde
// obejít).
//
// Jeden webhook pro všechny platby: dary, Kine Plus, předplatné tvůrců
// a podpory ve vysílání. Ve Stripe (Developers -> Webhooks) adresa
// https://<web>/api/donate/webhook a události checkout.session.completed,
// checkout.session.async_payment_succeeded, customer.subscription.updated,
// customer.subscription.deleted a charge.dispute.created; podpisový klíč
// (whsec_…) do STRIPE_WEBHOOK_SECRET. Když zápis do databáze selže, vrátí se
// 500 a Stripe to zkusí znovu (všechny zápisy jde bezpečně opakovat).
//
// Kine Plus se vždycky počítá z AKTUÁLNÍHO stavu předplatného u Stripe
// (stáhne se znovu), ne z obsahu události - Stripe události nedoručuje
// v pořadí a starší "aktivní" by jinak mohla přepsat novější "zrušené".
// Pravidla (do kdy platí, nezaplacená platba, zrušení) jsou v lib/plusBilling.ts.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Chybí podpis.' }, { status: 400 });
  }

  // trim: mezera / nový řádek na konci hodnoty z Vercelu by jinak shodil každé ověření.
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  // Bez klíče by knihovna Stripe ověřila i podpis prázdným klíčem - kdokoliv by si
  // mohl „zaplatit“ podvrženou událostí (třeba na náhledovém nasazení bez klíče).
  if (!/^whsec_[A-Za-z0-9]{20,}$/.test(secret)) {
    console.error('Kine: STRIPE_WEBHOOK_SECRET chybí nebo je neúplný - webhook nic nepřijme.');
    return NextResponse.json({ error: 'Webhook není nastavený.' }, { status: 500 });
  }

  let event;
  try {
    event = stripeServer.webhooks.constructEvent(body, signature, secret);
  } catch (err: any) {
    return NextResponse.json({ error: `Ověření podpisu selhalo: ${err.message}` }, { status: 400 });
  }

  // Podpora ve vysílání (app/api/live/tip) - jde tvůrci, ne appce: nesmí se
  // zapsat jako dar Kine (dřív se každá jednorázová platba brala jako dar).
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as any;
    // Super díky pod videem (app/api/videos/thanks) - stejná tabulka live_tips, jen bez chatu.
    if (session.mode === 'payment' && (session.metadata?.kind === 'live-tip' || session.metadata?.kind === 'video-thanks')) {
      const result = await recordLiveTip(event.type === 'checkout.session.async_payment_succeeded' ? { ...session, payment_status: 'paid' } : session);
      if (!result.ok) return retryLater(result.error);
      return NextResponse.json({ received: true });
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;

    // Jen zaplacený dar (platba převodem apod. přijde až s async_payment_succeeded - ta se tu nezapisuje).
    if (session.mode === 'payment' && session.payment_status === 'paid') {
      // Jednorázový dar appky. Stripe může stejnou událost poslat víckrát - dar se zapíše jen jednou.
      const userId = session.metadata?.userId;
      const amountTotal = session.amount_total ? session.amount_total / 100 : 0;

      const existing = await supabaseServer.from('donations').select('id').eq('stripe_session_id', session.id).limit(1);
      if (!existing.error && (existing.data ?? []).length === 0) {
        const { error } = await supabaseServer.from('donations').insert({
          user_id: userId ?? null,
          amount_eur: amountTotal,
          stripe_session_id: session.id,
        });
        if (error) return retryLater(error.message);
      }

      if (userId) {
        const { error } = await supabaseServer.from('profiles').update({ is_supporter: true }).eq('id', userId);
        if (error) return retryLater(error.message);
      }
    }

    if (session.mode === 'subscription' && session.metadata?.kind === 'kine-plus') {
      // Koupené předplatné (app/api/plus/checkout): stav a konec období přímo
      // od Stripe. Když se to nepovede, 500 - Stripe událost pošle znovu
      // (dřív se předplatné zapsalo bez konce a platilo by napořád).
      const userId = session.metadata?.userId;
      if (userId) {
        let sub: any;
        try {
          sub = await stripeServer.subscriptions.retrieve(session.subscription);
        } catch (e: any) {
          return retryLater(`Stripe: ${e?.message ?? 'předplatné nejde načíst'}`);
        }
        const state = plusFromSubscription(sub, { metadataTier: sub?.metadata?.tier ?? session.metadata?.tier, tierFromPrice: tierFromStripePriceId });

        // Starší předplatné téhož účtu (koupil podruhé ve dvou oknech, nebo po
        // nezaplacení znovu): zrušit, ať se neplatí dvakrát - a když ho zaplatil
        // před chvílí (dvě okna), vrátit mu tu platbu celou.
        const { data: before } = await supabaseServer.from('profiles').select('plan_stripe_subscription_id').eq('id', userId).maybeSingle();
        const previous = (before as { plan_stripe_subscription_id?: string | null } | null)?.plan_stripe_subscription_id;
        if (previous && previous !== sub.id) {
          try {
            const old: any = await stripeServer.subscriptions.retrieve(previous, { expand: ['latest_invoice'] });
            if (['active', 'trialing', 'past_due', 'unpaid'].includes(String(old?.status))) {
              await stripeServer.subscriptions.cancel(previous);
              await refundDuplicate(old);
            }
          } catch {
            // Staré předplatné už není - nic.
          }
        }

        const { error } = await supabaseServer
          .from('profiles')
          .update({
            plan: state.plan,
            plan_until: state.planUntil,
            plan_stripe_subscription_id: sub.id ?? session.subscription,
            plan_stripe_customer_id: session.customer,
          })
          .eq('id', userId);
        if (error) return retryLater(error.message);
      }
    } else if (session.mode === 'subscription') {
      // Vzniklo nové předplatné konkrétního tvůrce. Stav přímo od Stripe (ne z události) -
      // opakovaná starší událost by jinak zrušené členství znovu „aktivovala“.
      const subscriberId = session.metadata?.subscriberId;
      const creatorId = session.metadata?.creatorId;

      if (subscriberId && creatorId && session.subscription) {
        let sub: any;
        try {
          sub = await stripeServer.subscriptions.retrieve(session.subscription);
        } catch (e: any) {
          if (e?.statusCode === 404 || e?.code === 'resource_missing') sub = { id: session.subscription, status: 'canceled' };
          else return retryLater(`Stripe: ${e?.message ?? 'předplatné nejde načíst'}`);
        }
        const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
        const { error } = await supabaseServer.from('channel_subscriptions').upsert(
          {
            subscriber_id: subscriberId,
            creator_id: creatorId,
            status: membershipStatus(sub.status),
            stripe_subscription_id: sub.id ?? session.subscription,
            stripe_customer_id: session.customer,
            current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          },
          { onConflict: 'subscriber_id,creator_id' }
        );
        if (error) return retryLater(error.message);
      }
    }
  }

  if ((event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') && (event.data.object as any)?.metadata?.kind === 'kine-plus') {
    // Předplatné Kine: aktuální stav od Stripe (události chodí i mimo pořadí).
    // Zrušené / nezaplacené = free; pravidla v lib/plusBilling.ts.
    let sub: any = event.data.object as any;
    try {
      sub = await stripeServer.subscriptions.retrieve(sub.id);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.code === 'resource_missing') sub = { ...sub, status: 'canceled' };
      else return retryLater(`Stripe: ${e?.message ?? 'předplatné nejde načíst'}`);
    }
    const state = plusFromSubscription(sub, { metadataTier: sub?.metadata?.tier, tierFromPrice: tierFromStripePriceId });
    const { error } = await supabaseServer
      .from('profiles')
      .update({ plan: state.plan, plan_until: state.planUntil })
      .eq('plan_stripe_subscription_id', sub.id);
    if (error) return retryLater(error.message);
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    // Členství u tvůrce: aktuální stav od Stripe (události chodí i mimo pořadí - starší
    // „aktivní“ po „zrušeno“ by jinak členství vrátila natrvalo).
    let sub: any = event.data.object as any;
    try {
      sub = await stripeServer.subscriptions.retrieve(sub.id);
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.code === 'resource_missing') sub = { ...sub, status: 'canceled' };
      else return retryLater(`Stripe: ${e?.message ?? 'předplatné nejde načíst'}`);
    }
    const status = membershipStatus(sub.status);
    // Novější verze API Stripe mají konec období u položky předplatného, ne u předplatného.
    const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

    const { error } = await supabaseServer
      .from('channel_subscriptions')
      .update({
        status,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      })
      .eq('stripe_subscription_id', sub.id);
    if (error) return retryLater(error.message);
  }

  if (event.type === 'charge.dispute.created') {
    // Sporná platba (chargeback): kdo si peníze nechává vrátit přes banku,
    // předplatné dál mít nemá - zruší se hned (Kine Plus i předplatné kanálu).
    const dispute = event.data.object as any;
    const chargeId = typeof dispute?.charge === 'string' ? dispute.charge : dispute?.charge?.id;
    if (chargeId) {
      let charge: any = null;
      try {
        charge = await stripeServer.charges.retrieve(chargeId, { expand: ['invoice'] } as any);
      } catch {
        // Novější API Stripe fakturu u platby nemá - bez rozbalení.
        try {
          charge = await stripeServer.charges.retrieve(chargeId);
        } catch (e: any) {
          return retryLater(`Stripe: ${e?.message ?? 'platbu nejde načíst'}`);
        }
      }
      // Sporná podpora / Super díky: peníze, které šly tvůrci, se mu vezmou zpět.
      await reverseTipPayment(charge, 'dispute');
      let subscriptionId = subscriptionIdFromCharge(charge);
      if (!subscriptionId && typeof charge?.invoice === 'string') {
        try {
          subscriptionId = subscriptionIdFromCharge({ invoice: await stripeServer.invoices.retrieve(charge.invoice) });
        } catch {
          // Faktura nejde načíst - zkusí se podle zákazníka.
        }
      }
      if (!subscriptionId && typeof charge?.customer === 'string') {
        const { data: owner } = await supabaseServer.from('profiles').select('plan_stripe_subscription_id').eq('plan_stripe_customer_id', charge.customer).maybeSingle();
        subscriptionId = (owner as { plan_stripe_subscription_id?: string | null } | null)?.plan_stripe_subscription_id ?? null;
      }
      if (subscriptionId) {
        try {
          await stripeServer.subscriptions.cancel(subscriptionId);
        } catch {
          // Už zrušené - nevadí.
        }
        const plus = await supabaseServer.from('profiles').update({ plan: 'free', plan_until: null }).eq('plan_stripe_subscription_id', subscriptionId);
        if (plus.error) return retryLater(plus.error.message);
        await supabaseServer.from('channel_subscriptions').update({ status: 'canceled' }).eq('stripe_subscription_id', subscriptionId).then(
          () => undefined,
          () => undefined
        );
      }
    }
  }

  if (event.type === 'charge.refunded') {
    // Vrácená podpora / Super díky / platba členství (celá částka): tvůrci se peníze vezmou zpět.
    const charge = event.data.object as any;
    if (charge?.refunded === true) await reverseTipPayment(charge, 'refund');
  }

  return NextResponse.json({ received: true });
}

/**
 * Vrácená nebo sporná platba u podpory ve vysílání / Super díky (live_tips):
 * zmizí (status refunded) a peníze, které šly tvůrci (destination charge), se
 * mu vezmou zpět - jinak by spor nebo vrácení zaplatilo Kine ze svého. Jen
 * jednou (idempotencyKey); chyba nic neblokuje (jen záznam v logu).
 */
async function reverseTipPayment(charge: any, why: 'dispute' | 'refund'): Promise<void> {
  const paymentIntent = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id;
  let tipId: number | null = null;
  if (paymentIntent) {
    const { data, error } = await supabaseServer.from('live_tips').select('id, status').eq('stripe_payment_intent', paymentIntent).maybeSingle();
    if (!error && data) {
      const tip = data as { id: number; status: string };
      tipId = tip.id;
      if (tip.status !== 'refunded') await supabaseServer.from('live_tips').update({ status: 'refunded' }).eq('id', tip.id);
    }
  }
  // Peníze, které šly tvůrci (destination charge) - podpory, Super díky i platby
  // předplatného kanálu. Kine Plus a dary převod na tvůrce nemají, tady nic.
  const transfer = typeof charge?.transfer === 'string' ? charge.transfer : charge?.transfer?.id;
  if (!transfer) return;
  try {
    await stripeServer.transfers.createReversal(
      transfer,
      { metadata: { reason: why, ...(tipId !== null ? { tipId: String(tipId) } : { charge: String(charge?.id ?? '') }) } },
      { idempotencyKey: `kine-tip-reversal-${transfer}` }
    );
  } catch (e: any) {
    // Už vrácené (třeba ručně ve Stripe nebo při vrácení s reverse_transfer), nebo tvůrce nemá na účtu dost - jen záznam.
    console.warn(`Kine: peníze z platby ${tipId ?? charge?.id ?? '?'} se nepodařilo vzít tvůrci zpět (${why}): ${e?.message ?? e}`);
  }
}

/** Stav členství u tvůrce podle Stripe: aktivní / zkušební = člen, nezaplacené čeká, jinak konec. */
function membershipStatus(status: unknown): 'active' | 'past_due' | 'canceled' {
  return status === 'active' || status === 'trialing' ? 'active' : status === 'past_due' ? 'past_due' : 'canceled';
}

/**
 * Zdvojené Kine Plus (dvě okna): platba staršího předplatného z posledních
 * 2 dnů se vrátí celá - první měsíc by jinak zaplatil dvakrát. Jen jednou
 * (idempotencyKey), chyba nic neblokuje (jen záznam v logu).
 */
async function refundDuplicate(old: any) {
  const inv = old?.latest_invoice;
  if (!inv || typeof inv !== 'object' || inv.status !== 'paid' || !(Number(inv.amount_paid) > 0)) return;
  const paidAt = Number(inv.status_transitions?.paid_at ?? 0);
  if (!paidAt || Date.now() / 1000 - paidAt > 2 * 24 * 3600) return;
  const paymentIntent = typeof inv.payment_intent === 'string' ? inv.payment_intent : inv.payment_intent?.id;
  const charge = typeof inv.charge === 'string' ? inv.charge : inv.charge?.id;
  if (!paymentIntent && !charge) return;
  try {
    await stripeServer.refunds.create(
      { ...(paymentIntent ? { payment_intent: paymentIntent } : { charge }), reason: 'duplicate', metadata: { kind: 'kine-plus-duplicate', subscription: String(old.id) } },
      { idempotencyKey: `kine-plus-duplicate-${old.id}` }
    );
  } catch (e: any) {
    console.warn(`Kine Plus: zdvojenou platbu (${old.id}) se nepodařilo vrátit: ${e?.message ?? e}`);
  }
}

/** Zápis do databáze selhal - 500, ať Stripe událost pošle znovu (dělá to až 3 dny). */
function retryLater(message: string) {
  return NextResponse.json({ error: `Databáze: ${message}` }, { status: 500 });
}
