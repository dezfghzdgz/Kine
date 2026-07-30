import { NextRequest, NextResponse } from 'next/server';
import { stripeServer } from '@/lib/stripeServer';
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

    if (session.mode === 'subscription') {
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

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
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
