import Stripe from 'stripe';
import { supabaseServer } from './supabaseServer';
import { keyMode, stripeMissing } from './stripeSetup';

/**
 * Zrušení předplatných u Stripe při smazání účtu.
 *
 * Dřív se při smazání účtu smazal jen záznam v databázi - předplatné u Stripe
 * běželo dál a z karty se strhávalo každý měsíc, i když účet už neexistoval.
 * Teď se před smazáním zruší:
 *  - vlastní Kine Plus (profiles.plan_stripe_subscription_id),
 *  - členství u tvůrců, která uživatel platí (channel_subscriptions.subscriber_id),
 *  - členství, která platí jiní jemu jako tvůrci (creator_id) - smazanému kanálu
 *    by jinak platili dál za nic.
 * Okamžitě a bez dalšího vyúčtování. Předplatné, které u Stripe už není
 * (jiný režim, dřív zrušené), se bere jako zrušené.
 */
export type CancelResult = { ok: boolean; cancelled: number; failed: string[] };

const ALREADY = /already (been )?cancel+ed|status of canceled|is canceled/i;

export async function cancelStripeSubscriptionsOf(userId: string): Promise<CancelResult> {
  const ids = new Set<string>();
  const profile = await supabaseServer.from('profiles').select('plan_stripe_subscription_id').eq('id', userId).maybeSingle();
  const own = (profile.data as { plan_stripe_subscription_id?: string | null } | null)?.plan_stripe_subscription_id;
  if (!profile.error && own) ids.add(own);
  // Po stránkách (databáze vrací nejvýš 1000 řádků) - tvůrce může mít víc členů.
  // Bez migrace členství (tabulka chybí) dotaz vrátí chybu - pak tu prostě nic není.
  const PAGE = 1000;
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const page = await supabaseServer
      .from('channel_subscriptions')
      .select('stripe_subscription_id')
      .or(`subscriber_id.eq.${userId},creator_id.eq.${userId}`)
      .in('status', ['active', 'past_due'])
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (page.error) break;
    const rows = (page.data ?? []) as { stripe_subscription_id: string | null }[];
    for (const m of rows) if (m.stripe_subscription_id) ids.add(m.stripe_subscription_id);
    if (rows.length < PAGE) break;
  }
  if (ids.size === 0) return { ok: true, cancelled: 0, failed: [] };

  const key = process.env.STRIPE_SECRET_KEY;
  const mode = keyMode(key);
  // Bez klíče Stripe placení neběží - předplatné nejde zrušit, ale ani strhávat přes Kine.
  if (mode !== 'test' && mode !== 'live') return { ok: false, cancelled: 0, failed: [...ids] };
  const stripe = new Stripe(key!.trim(), { apiVersion: '2024-06-20' });

  // Po osmi naráz - stovky členů se tak stihnou v čase, který má server na odpověď.
  // Kdyby to nestihl, smazání účtu skončí chybou a jde zopakovat (zrušená se přeskočí).
  let cancelled = 0;
  const failed: string[] = [];
  const queue = [...ids];
  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        await stripe.subscriptions.cancel(id, { invoice_now: false, prorate: false });
        cancelled += 1;
      } catch (e: any) {
        if (stripeMissing(e) || ALREADY.test(String(e?.message ?? ''))) continue;
        failed.push(id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return { ok: failed.length === 0, cancelled, failed };
}
