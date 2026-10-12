import { supabaseServer } from './supabaseServer';
import { channelRoom } from './liveChat';
import { formatTipAmount } from './liveTips';

/**
 * Podpory ve vysílání - serverová část (logika a limity v lib/liveTips.ts).
 */

export type TipTarget =
  | { ok: true; accountId: string; name: string }
  | { ok: false; reason: 'missing' | 'banned' | 'not-connected' | 'disabled' | 'unavailable' };

/**
 * Může kanál dostávat podpory? Stripe propojený a dokončený, podpory
 * nevypnuté, kanál nezablokovaný. select('*') schválně - sloupec
 * live_tips_enabled je až s migrací (bez ní podpory nejdou: chybí i tabulka).
 */
export async function tipTarget(channelId: string): Promise<TipTarget> {
  const { data, error } = await supabaseServer.from('profiles').select('*').eq('id', channelId).maybeSingle();
  if (error || !data) return { ok: false, reason: 'missing' };
  const p = data as Record<string, any>;
  if (p.is_banned || p.is_shadow_banned) return { ok: false, reason: 'banned' };
  if (!Object.prototype.hasOwnProperty.call(p, 'live_tips_enabled')) return { ok: false, reason: 'unavailable' };
  if (!p.stripe_account_id || !p.stripe_onboarding_complete) return { ok: false, reason: 'not-connected' };
  if (p.live_tips_enabled === false) return { ok: false, reason: 'disabled' };
  return { ok: true, accountId: String(p.stripe_account_id), name: String(p.display_name || p.username || 'Kine') };
}

/**
 * Zaplacená podpora (webhook Stripe, checkout.session.completed): zapíše
 * se jako zaplacená, objeví se v chatu přenosu a tvůrce dostane oznámení.
 * Právě jednou - kdo první přepne pending -> paid, ten ji zpracuje; když
 * zápis do chatu selže, vrátí se na pending a Stripe událost pošle znovu.
 */
export async function recordLiveTip(session: any): Promise<{ ok: true } | { ok: false; error: string }> {
  const tipId = Number(session?.metadata?.tipId);
  if (!Number.isFinite(tipId) || tipId <= 0) return { ok: true };
  // Platba ještě není dokončená (třeba bankovní převod) - přijde async_payment_succeeded.
  if (session?.payment_status && session.payment_status !== 'paid') return { ok: true };

  const claim = await supabaseServer
    .from('live_tips')
    .update({ status: 'paid', paid_at: new Date().toISOString(), stripe_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : null })
    .eq('id', tipId)
    .eq('status', 'pending')
    .select('*');
  if (claim.error) return { ok: false, error: claim.error.message };
  const tip = claim.data?.[0] as Record<string, any> | undefined;
  if (!tip) return { ok: true }; // už zpracovaná (Stripe poslal událost znovu)
  if (tip.stripe_session_id && session.id && tip.stripe_session_id !== session.id) {
    // Nesedí relace - radši nic, vrátit zpět.
    await supabaseServer.from('live_tips').update({ status: 'pending', paid_at: null }).eq('id', tipId);
    return { ok: true };
  }

  const message = String(tip.message ?? '').trim();
  const room = channelRoom(String(tip.channel_id));
  let chat = await supabaseServer
    .from('live_chat_messages')
    .insert({ room, user_id: tip.user_id, body: message || '💛', kind: 'tip', tip_amount_cents: tip.amount_cents, tip_currency: tip.currency })
    .select('id')
    .single();
  if (chat.error && /kind|tip_amount|tip_currency/i.test(chat.error.message ?? '')) {
    // Chat bez sloupců pro podpory (stará databáze) - aspoň jako zvýrazněný text.
    const amount = formatTipAmount(tip.amount_cents, tip.currency, 'cs');
    chat = await supabaseServer
      .from('live_chat_messages')
      .insert({ room, user_id: tip.user_id, body: `💛 ${amount}${message ? `: ${message}` : ''}`.slice(0, 300) })
      .select('id')
      .single();
  }
  if (chat.error || !chat.data) {
    if (tip.user_id) {
      // Bez chatu: vrátit na "pending", ať to Stripe zkusí znovu.
      await supabaseServer.from('live_tips').update({ status: 'pending', paid_at: null }).eq('id', tipId);
      return { ok: false, error: chat.error?.message ?? 'chat' };
    }
  } else {
    await supabaseServer.from('live_tips').update({ chat_message_id: chat.data.id }).eq('id', tipId);
  }

  // Oznámení tvůrci (zvoneček).
  let name = 'Někdo';
  if (tip.user_id) {
    const { data: who } = await supabaseServer.from('profiles').select('username, display_name').eq('id', tip.user_id).maybeSingle();
    name = who?.display_name || who?.username || name;
  }
  const amount = formatTipAmount(tip.amount_cents, tip.currency, 'cs');
  await supabaseServer.from('notifications').insert({
    user_id: tip.channel_id,
    type: 'donation',
    message: `💛 Podpora ${amount} od ${name}${message ? `: „${message.slice(0, 120)}“` : ''}`,
    link: '/live',
  });
  return { ok: true };
}
