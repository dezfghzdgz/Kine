import { NextRequest, NextResponse } from 'next/server';
import { CREATOR_PAYMENTS_ENABLED, CREATOR_PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { siteUrlFrom } from '@/lib/siteUrl';
import { channelRoom, parseChatRoom } from '@/lib/liveChat';
import { checkChatMessage, containsLink } from '@/lib/liveChatRules';
import { activeBan, loadChatSettings } from '@/lib/liveChatModeration';
import { cleanTipMessage, formatTipAmount, parseTipCurrency, tipAmountCents, tipFeeCents, tipFeePercent } from '@/lib/liveTips';
import { tipTarget } from '@/lib/liveTipsServer';
import { paymentAllowedNow, TEST_MODE_OFF } from '@/lib/paymentsServer';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nejvýš tolik rozdělaných plateb za 10 minut na člověka (proti zahlcení). */
const MAX_PENDING_PER_10_MIN = 6;

/**
 * Podpora ve vysílání: { channelId, amount, currency, message } -> adresa
 * platby Stripe. Peníze jdou na Stripe účet tvůrce (destination charge),
 * Kine si nechá poplatek (LIVE_TIP_FEE_PERCENT, výchozí 15 %, aspoň 8 Kč /
 * 0,30 €, ze kterého platí poplatek Stripe). Vzkaz se do chatu dostane až
 * po zaplacení (webhook, lib/liveTipsServer.ts) a platí pro něj pravidla
 * chatu kanálu (zakázaná slova, zákaz psaní) - odkazy ve vzkazu nikdy.
 */
export async function POST(req: NextRequest) {
  // Peníze pro tvůrce zatím neběží (lib/payments.ts, NEXT_PUBLIC_CREATOR_PAYMENTS) - nic se nezaplatí ani omylem.
  if (!CREATOR_PAYMENTS_ENABLED) return NextResponse.json(CREATOR_PAYMENTS_OFF, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.', code: 'login' }, { status: 401 });
  // Testovací klíč Stripe: zkouší jen správce (lib/paymentsServer.ts).
  if (!(await paymentAllowedNow(user.id))) return NextResponse.json(TEST_MODE_OFF, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channelId ?? '').toLowerCase();
  if (!UUID.test(channelId)) return NextResponse.json({ error: 'Neplatný kanál.' }, { status: 400 });
  if (channelId === user.id) return NextResponse.json({ error: 'Sám sobě podporu poslat nejde.', code: 'self' }, { status: 400 });
  const currency = parseTipCurrency(body?.currency);
  if (!currency) return NextResponse.json({ error: 'Neplatná měna.', code: 'currency' }, { status: 400 });
  const amountCents = tipAmountCents(body?.amount, currency);
  if (amountCents === null) return NextResponse.json({ error: 'Částka je mimo povolený rozsah.', code: 'amount' }, { status: 400 });
  const message = cleanTipMessage(body?.message);

  const target = await tipTarget(channelId);
  if (!target.ok) return NextResponse.json({ error: 'Tenhle kanál teď podpory nepřijímá.', code: target.reason }, { status: 400 });

  const { data: me } = await supabaseServer.from('profiles').select('is_banned').eq('id', user.id).maybeSingle();
  if (!me || me.is_banned) return NextResponse.json({ error: 'Účet nemůže posílat podpory.', code: 'banned' }, { status: 403 });

  // Vzkaz podle pravidel chatu: zákaz / ztlumení v chatu kanálu, zakázaná slova. Odkazy ve vzkazu nikdy
  // (čte se nahlas a ukazuje zvýrazněný). Pomalý režim a "jen odběratelé" se na podporu nevztahují.
  const room = parseChatRoom(channelRoom(channelId))!;
  const [{ settings }, ban] = await Promise.all([loadChatSettings(room.key), activeBan(room.key, user.id)]);
  if (message && containsLink(message)) return NextResponse.json({ error: 'Odkazy do vzkazu nejdou.', code: 'links' }, { status: 400 });
  const rejection = checkChatMessage({
    text: message || '💛',
    settings: { ...settings, slowSeconds: 0, followersOnly: false, minAccountMinutes: 0 },
    exempt: false,
    now: Date.now(),
    lastMessageAt: null,
    followingSince: null,
    accountCreatedAt: null,
    ban,
  });
  if (rejection) return NextResponse.json({ error: 'Vzkaz teď nejde poslat.', ...rejection }, { status: 403 });

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await supabaseServer.from('live_tips').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'pending').gte('created_at', since);
  if (isMissingTable(recent.error)) return NextResponse.json({ error: 'Podpory ještě nejsou v databázi zapnuté.', code: 'unavailable' }, { status: 503 });
  if ((recent.count ?? 0) >= MAX_PENDING_PER_10_MIN) return NextResponse.json({ error: 'Pomaleji :)', code: 'slow' }, { status: 429 });

  const feeCents = tipFeeCents(amountCents, tipFeePercent(process.env.LIVE_TIP_FEE_PERCENT), currency);
  const { data: tip, error } = await supabaseServer
    .from('live_tips')
    .insert({ channel_id: channelId, user_id: user.id, amount_cents: amountCents, currency, fee_cents: feeCents, message, status: 'pending' })
    .select('id')
    .single();
  if (error || !tip) return NextResponse.json({ error: error?.message ?? 'Podporu se nepodařilo založit.' }, { status: 500 });

  const siteUrl = siteUrlFrom(req);
  try {
    const sessionParams: any = {
      mode: 'payment',
      // Stejně jako u daru appce: "Managed Payments" by chtěly daňový kód produktu.
      managed_payments: { enabled: false },
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              // Zákazník vidí na platební stránce - anglicky (základní jazyk Kine).
              name: `Tip for ${target.name} on Kine`,
              description: message ? `Message: ${message.slice(0, 120)}` : 'Tip in a live stream on Kine.',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: target.accountId },
        metadata: { kind: 'live-tip', tipId: String(tip.id), channelId },
      },
      metadata: { kind: 'live-tip', tipId: String(tip.id), channelId, userId: user.id },
      success_url: `${siteUrl}/live/${channelId}?tip=thanks`,
      cancel_url: `${siteUrl}/live/${channelId}?tip=cancel`,
    };
    const session = await stripeServer.checkout.sessions.create(sessionParams);
    await supabaseServer.from('live_tips').update({ stripe_session_id: session.id }).eq('id', tip.id);
    return NextResponse.json({ url: session.url, amount: formatTipAmount(amountCents, currency, 'cs') });
  } catch (err: any) {
    await supabaseServer.from('live_tips').update({ status: 'failed' }).eq('id', tip.id);
    return NextResponse.json({ error: err?.message ?? 'Platbu se nepodařilo založit.' }, { status: 500 });
  }
}
