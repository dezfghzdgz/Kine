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

  let event;
  try {
    event = stripeServer.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Ověření podpisu selhalo: ${err.message}` }, { status: 400 });
  }

  // Podpora ve vysílání (app/api/live/tip) - jde tvůrci, ne appce: nesmí se
  // zapsat jako dar Kine (dřív se každá jednorázová platba brala jako dar).
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as any;
    if (session.mode === 'payment' && session.metadata?.kind === 'live-tip') {
      const result = await recordLiveTip(event.type === 'checkout.session.async_payment_succeeded' ? { ...session, payment_status: 'paid' } : session);
      if (!result.ok) return retryLater(result.error);
      return NextResponse.json({ received: true });
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;

    if (session.mode === 'payment') {
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
        // nezaplacení znovu): zrušit, ať se neplatí dvakrát.
        const { data: before } = await supabaseServer.from('profiles').select('plan_stripe_subscription_id').eq('id', userId).maybeSingle();
        const previous = (before as { plan_stripe_subscription_id?: string | null } | null)?.plan_stripe_subscription_id;
        if (previous && previous !== sub.id) {
          try {
            const old = await stripeServer.subscriptions.retrieve(previous);
            if (['active', 'trialing', 'past_due', 'unpaid'].includes(String(old?.status))) await stripeServer.subscriptions.cancel(previous);
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
      // Vzniklo nové aktivní předplatné konkrétního tvůrce.
      const subscriberId = session.metadata?.subscriberId;
      const creatorId = session.metadata?.creatorId;

      if (subscriberId && creatorId) {
        const { error } = await supabaseServer.from('channel_subscriptions').upsert(
          {
            subscriber_id: subscriberId,
            creator_id: creatorId,
            status: 'active',
            stripe_subscription_id: session.subscription,
            stripe_customer_id: session.customer,
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
    const sub = event.data.object as any;
    // Členství u tvůrce: aktivní / zkušební = člen, nezaplacené čeká (past_due), cokoliv jiného
    // (zrušené, nezaplacené po všech pokusech, pozastavené, nedokončené) = konec.
    const status = event.type === 'customer.subscription.deleted'
      ? 'canceled'
      : sub.status === 'active' || sub.status === 'trialing'
        ? 'active'
        : sub.status === 'past_due'
          ? 'past_due'
          : 'canceled';
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

  return NextResponse.json({ received: true });
}

/** Zápis do databáze selhal - 500, ať Stripe událost pošle znovu (dělá to až 3 dny). */
function retryLater(message: string) {
  return NextResponse.json({ error: `Databáze: ${message}` }, { status: 500 });
}
