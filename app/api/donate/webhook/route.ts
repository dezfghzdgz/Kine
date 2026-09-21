import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
import { isPaidTier, tierFromStripePriceId, type PaidTier } from '@/lib/plus';
import { supabaseServer } from '@/lib/supabaseServer';

// Appka poslouchá na "checkout.session.completed" - to je jediná chvíle,
// kdy appka může s jistotou vědět, že platba opravdu proběhla (nestačí
// jen appce věřit, že se úspěšně vrátil na "thank-you" stránku - to jde
// obejít).
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;

    if (session.mode === 'payment') {
      // Jednorázový dar appky.
      const userId = session.metadata?.userId;
      const amountTotal = session.amount_total ? session.amount_total / 100 : 0;

      await supabaseServer.from('donations').insert({
        user_id: userId ?? null,
        amount_eur: amountTotal,
        stripe_session_id: session.id,
      });

      if (userId) {
        await supabaseServer.from('profiles').update({ is_supporter: true }).eq('id', userId);
      }
    }

    if (session.mode === 'subscription' && session.metadata?.kind === 'kine-plus') {
      // Koupené předplatné (app/api/plus/checkout): varianta je v metadatech
      // (kine / clips / all). Konec období si přečteme z předplatného, ať
      // po nezaplacení samo vyprší.
      const userId = session.metadata?.userId;
      if (userId) {
        let periodEnd: string | null = null;
        let sub: any = null;
        try {
          sub = await stripeServer.subscriptions.retrieve(session.subscription);
          periodEnd = plusUntilFromSubscription(sub);
        } catch {
          // Bez konce období: předplatné platí, dokud webhook nepřijde s update.
        }
        await supabaseServer
          .from('profiles')
          .update({
            plan: planFromSubscription(sub, session.metadata?.tier),
            plan_until: periodEnd,
            plan_stripe_subscription_id: session.subscription,
            plan_stripe_customer_id: session.customer,
          })
          .eq('id', userId);
      }
    } else if (session.mode === 'subscription') {
      // Vzniklo nové aktivní předplatné konkrétního tvůrce.
      const subscriberId = session.metadata?.subscriberId;
      const creatorId = session.metadata?.creatorId;

      if (subscriberId && creatorId) {
        await supabaseServer.from('channel_subscriptions').upsert(
          {
            subscriber_id: subscriberId,
            creator_id: creatorId,
            status: 'active',
            stripe_subscription_id: session.subscription,
            stripe_customer_id: session.customer,
          },
          { onConflict: 'subscriber_id,creator_id' }
        );
      }
    }
  }

  if ((event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') && (event.data.object as any)?.metadata?.kind === 'kine-plus') {
    // Předplatné Kine: aktivní/zkušební = varianta do konce období (+3 dny
    // rezerva na opožděnou platbu), cokoliv jiného (zrušené, nezaplacené)
    // = free. Změna varianty v portálu Stripe = jiná cena v položkách.
    const sub = event.data.object as any;
    const active = event.type !== 'customer.subscription.deleted' && (sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due');
    await supabaseServer
      .from('profiles')
      .update(active ? { plan: planFromSubscription(sub, sub.metadata?.tier), plan_until: plusUntilFromSubscription(sub) } : { plan: 'free', plan_until: null })
      .eq('plan_stripe_subscription_id', sub.id);
  } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as any;
    const status = event.type === 'customer.subscription.deleted'
      ? 'canceled'
      : (sub.status === 'past_due' ? 'past_due' : 'active');

    await supabaseServer
      .from('channel_subscriptions')
      .update({
        status,
        current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      })
      .eq('stripe_subscription_id', sub.id);
  }

  return NextResponse.json({ received: true });
}

/**
 * Varianta předplatného: podle ceny v předplatném (změna v portálu), jinak
 * podle metadat z nákupu; když nic nesedí, 'all' (starší jediná varianta).
 */
function planFromSubscription(sub: any, metadataTier: unknown): PaidTier {
  const priceId = sub?.items?.data?.[0]?.price?.id ?? sub?.plan?.id ?? null;
  return tierFromStripePriceId(priceId) ?? (isPaidTier(metadataTier) ? metadataTier : 'all');
}

/** Konec zaplaceného období + 3 dny rezervy; bez období null (= bez konce). */
function plusUntilFromSubscription(sub: any): string | null {
  const end = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  if (!end) return null;
  return new Date(end * 1000 + 3 * 24 * 60 * 60 * 1000).toISOString();
}
