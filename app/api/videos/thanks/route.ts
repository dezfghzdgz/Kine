import { NextRequest, NextResponse } from 'next/server';
import { CREATOR_PAYMENTS_ENABLED, CREATOR_PAYMENTS_OFF } from '@/lib/payments';
import { stripeServer } from '@/lib/stripeServer';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { siteUrlFrom } from '@/lib/siteUrl';
import { DEFAULT_CHAT_SETTINGS, checkChatMessage, containsLink } from '@/lib/liveChatRules';
import { channelRoom, parseChatRoom } from '@/lib/liveChat';
import { activeBan, loadChatSettings } from '@/lib/liveChatModeration';
import { keyMode } from '@/lib/stripeSetup';
import { cleanTipMessage, formatTipAmount, parseTipCurrency, tipAmountCents, tipFeeCents, tipFeePercent } from '@/lib/liveTips';
import { tipTarget } from '@/lib/liveTipsServer';
import { paymentAllowedNow, TEST_MODE_OFF } from '@/lib/paymentsServer';

export const dynamic = 'force-dynamic';

/**
 * Super díky pod videem (jako Super Thanks na YouTube): divák pošle tvůrci
 * částku a krátký vzkaz, ten se ukáže zvýrazněný pod videem.
 *
 * Stejné jako podpory ve vysílání (app/api/live/tip): peníze jdou přes Stripe
 * rovnou na Stripe účet tvůrce (Connect, destination charge), Kine si nechá
 * poplatek (LIVE_TIP_FEE_PERCENT, výchozí 15 %, aspoň tolik, kolik stojí
 * platba). Záznam v live_tips s video_id (supabase-migration-super-diky.sql);
 * zaplacení zapíše webhook (lib/liveTipsServer.ts recordLiveTip).
 *
 * GET   ?videoId=…  -> { enabled, canReceive, feePercent, items } (veřejné - vzkazy jsou pod videem pro všechny)
 * POST  { videoId, amount, currency, message } -> { url } platební stránky Stripe
 * PATCH { id, hidden } -> skrýt / vrátit vzkaz (tvůrce videa, moderátor, správce)
 *
 * Jen u veřejných videí. Vzkaz prochází stejnými pravidly jako podpora ve
 * vysílání (zakázaná slova kanálu, zákaz v chatu, žádné odkazy), u videa
 * s vypnutými komentáři Super díky nejdou. Vrácené a sporné platby
 * (webhook) zmizí; testovací platby se s ostrým klíčem neukazují.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nejvýš tolik rozdělaných plateb za 10 minut na člověka (stejně jako podpory ve vysílání). */
const MAX_PENDING_PER_10_MIN = 6;
const LIST_LIMIT = 20;

type VideoRow = { id: string; owner_id: string | null; title: string | null; visibility: string | null; status: string | null; comments_disabled?: boolean | null };

async function loadVideo(videoId: string): Promise<VideoRow | null> {
  // select('*') - comments_disabled je až s pozdější migrací.
  const { data } = await supabaseServer.from('videos').select('*').eq('id', videoId).maybeSingle();
  return (data as VideoRow | null) ?? null;
}

/** Super díky jdou jen u veřejného hotového videa (u videa pro odběratele by GET prozradil vzkazy komukoli). */
function thanksAllowedFor(video: VideoRow | null): video is VideoRow {
  return !!video && !!video.owner_id && video.status === 'ready' && video.visibility === 'public';
}

/** Platby z režimu, ve kterém Kine právě běží (testovací Super díky po přechodu na ostrý klíč zmizí). */
function sessionPrefix(): string {
  return keyMode(process.env.STRIPE_SECRET_KEY) === 'test' ? 'cs_test_%' : 'cs_live_%';
}

export async function GET(req: NextRequest) {
  const videoId = String(req.nextUrl.searchParams.get('videoId') ?? '').toLowerCase();
  const feePercent = tipFeePercent(process.env.LIVE_TIP_FEE_PERCENT);
  const off = { enabled: false, canReceive: false, feePercent, items: [] as unknown[] };
  if (!CREATOR_PAYMENTS_ENABLED || !UUID.test(videoId)) return NextResponse.json(off);

  const video = await loadVideo(videoId);
  if (!thanksAllowedFor(video)) return NextResponse.json({ ...off, enabled: true });

  const [target, list] = await Promise.all([
    tipTarget(video.owner_id as string),
    supabaseServer
      .from('live_tips')
      .select('id, user_id, amount_cents, currency, message, paid_at')
      .eq('video_id', videoId)
      .eq('status', 'paid')
      .is('hidden_at', null)
      .like('stripe_session_id', sessionPrefix())
      .order('paid_at', { ascending: false })
      .limit(LIST_LIMIT),
  ]);
  // Bez migrace (chybí sloupce video_id / hidden_at) Super díky nejdou - tlačítko se neukáže.
  if (list.error) return NextResponse.json({ ...off, enabled: true, unavailable: true });
  // Zablokovaný tvůrce: nic (jeho video ostatní stejně nevidí).
  if (!target.ok && target.reason === 'banned') return NextResponse.json({ ...off, enabled: true });

  const rows = (list.data ?? []) as { id: number; user_id: string | null; amount_cents: number; currency: string; message: string; paid_at: string | null }[];
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x)));
  const people = new Map<string, { name: string; avatar: string | null; hidden: boolean }>();
  if (userIds.length > 0) {
    const { data } = await supabaseServer.from('profiles').select('*').in('id', userIds);
    for (const p of (data ?? []) as { id: string; username: string | null; display_name: string | null; avatar_url: string | null; is_banned?: boolean; is_shadow_banned?: boolean }[]) {
      people.set(p.id, { name: p.display_name || p.username || 'Kine', avatar: p.avatar_url ?? null, hidden: !!(p.is_banned || p.is_shadow_banned) });
    }
  }
  // Vzkazy zablokovaných lidí (i když je zablokovali až potom) se neukazují.
  const visible = rows.filter((r) => !(r.user_id && people.get(r.user_id)?.hidden));
  const items = visible.map((r) => ({
    id: r.id,
    amountCents: r.amount_cents,
    currency: r.currency,
    message: r.message ?? '',
    paidAt: r.paid_at,
    userId: r.user_id,
    name: (r.user_id && people.get(r.user_id)?.name) || null,
    avatar: (r.user_id && people.get(r.user_id)?.avatar) || null,
  }));
  return NextResponse.json({ enabled: true, canReceive: target.ok, feePercent, items, ownerId: video.owner_id });
}

export async function POST(req: NextRequest) {
  // Peníze pro tvůrce zatím neběží (lib/payments.ts, NEXT_PUBLIC_CREATOR_PAYMENTS) - nic se nezaplatí ani omylem.
  if (!CREATOR_PAYMENTS_ENABLED) return NextResponse.json(CREATOR_PAYMENTS_OFF, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.', code: 'login' }, { status: 401 });
  // Testovací klíč Stripe: zkouší jen správce (lib/paymentsServer.ts).
  if (!(await paymentAllowedNow(user.id))) return NextResponse.json(TEST_MODE_OFF, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const videoId = String(body?.videoId ?? '').toLowerCase();
  if (!UUID.test(videoId)) return NextResponse.json({ error: 'Neplatné video.', code: 'video' }, { status: 400 });
  const currency = parseTipCurrency(body?.currency);
  if (!currency) return NextResponse.json({ error: 'Neplatná měna.', code: 'currency' }, { status: 400 });
  const amountCents = tipAmountCents(body?.amount, currency);
  if (amountCents === null) return NextResponse.json({ error: 'Částka je mimo povolený rozsah.', code: 'amount' }, { status: 400 });
  const message = cleanTipMessage(body?.message);
  if (message && containsLink(message)) return NextResponse.json({ error: 'Odkazy do vzkazu nejdou.', code: 'links' }, { status: 400 });

  const video = await loadVideo(videoId);
  if (!thanksAllowedFor(video)) return NextResponse.json({ error: 'U tohohle videa Super díky nejdou.', code: 'video' }, { status: 400 });
  if (video.comments_disabled) return NextResponse.json({ error: 'U tohohle videa jsou vypnuté komentáře.', code: 'comments-off' }, { status: 400 });
  const channelId = video.owner_id as string;
  if (channelId === user.id) return NextResponse.json({ error: 'Sám sobě Super díky poslat nejde.', code: 'self' }, { status: 400 });

  const target = await tipTarget(channelId);
  if (!target.ok) return NextResponse.json({ error: 'Tenhle tvůrce teď Super díky nepřijímá.', code: target.reason }, { status: 400 });

  const { data: me } = await supabaseServer.from('profiles').select('is_banned').eq('id', user.id).maybeSingle();
  if (!me || me.is_banned) return NextResponse.json({ error: 'Účet nemůže posílat Super díky.', code: 'banned' }, { status: 403 });

  // Stejná pravidla jako podpora ve vysílání: zákaz v chatu kanálu, zakázaná slova (zaplacením se moderace obejít nedá).
  const room = parseChatRoom(channelRoom(channelId));
  const [{ settings }, ban] = room
    ? await Promise.all([loadChatSettings(room.key), activeBan(room.key, user.id)])
    : [{ settings: DEFAULT_CHAT_SETTINGS }, null];
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
  if (isMissingTable(recent.error)) return NextResponse.json({ error: 'Super díky ještě nejsou v databázi zapnuté.', code: 'unavailable' }, { status: 503 });
  if ((recent.count ?? 0) >= MAX_PENDING_PER_10_MIN) return NextResponse.json({ error: 'Pomaleji :)', code: 'slow' }, { status: 429 });

  const feeCents = tipFeeCents(amountCents, tipFeePercent(process.env.LIVE_TIP_FEE_PERCENT), currency);
  const insert = await supabaseServer
    .from('live_tips')
    .insert({ channel_id: channelId, user_id: user.id, video_id: videoId, amount_cents: amountCents, currency, fee_cents: feeCents, message, status: 'pending' })
    .select('id')
    .single();
  if (insert.error || !insert.data) {
    // Bez migrace supabase-migration-super-diky.sql chybí sloupec video_id.
    const missingColumn = /video_id/i.test(insert.error?.message ?? '');
    return NextResponse.json(
      { error: missingColumn ? 'Super díky ještě nejsou v databázi zapnuté.' : (insert.error?.message ?? 'Super díky se nepodařilo založit.'), code: missingColumn ? 'unavailable' : 'failed' },
      { status: missingColumn ? 503 : 500 }
    );
  }
  const tipId = insert.data.id;

  const siteUrl = siteUrlFrom(req);
  const title = (video.title ?? '').trim().slice(0, 80);
  try {
    const sessionParams: any = {
      mode: 'payment',
      // Managed Payments (zapnuté na účtu jako výchozí) nepodporují peníze pro tvůrce (Connect).
      managed_payments: { enabled: false },
      // Platební stránka platí 35 minut (ne 24 h) - mezitím smazané video už nic nezaplatí.
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              // Zákazník vidí na platební stránce - anglicky (základní jazyk Kine).
              name: `Super Thanks for ${target.name} on Kine`,
              description: title ? `Video: ${title}` : 'Super Thanks on Kine.',
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: target.accountId },
        metadata: { kind: 'video-thanks', tipId: String(tipId), channelId, videoId },
      },
      metadata: { kind: 'video-thanks', tipId: String(tipId), channelId, videoId, userId: user.id },
      success_url: `${siteUrl}/watch/${videoId}?thanks=1`,
      cancel_url: `${siteUrl}/watch/${videoId}`,
    };
    const session = await stripeServer.checkout.sessions.create(sessionParams);
    await supabaseServer.from('live_tips').update({ stripe_session_id: session.id }).eq('id', tipId);
    return NextResponse.json({ url: session.url, amount: formatTipAmount(amountCents, currency, 'en') });
  } catch (err: any) {
    await supabaseServer.from('live_tips').update({ status: 'failed' }).eq('id', tipId);
    return NextResponse.json({ error: err?.message ?? 'Platbu se nepodařilo založit.', code: 'failed' }, { status: 502 });
  }
}

/** Skrýt / vrátit vzkaz Super díky: tvůrce videa, moderátor nebo správce (jako u komentářů). */
export async function PATCH(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.', code: 'login' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Neplatné Super díky.' }, { status: 400 });
  const { data: tip } = await supabaseServer.from('live_tips').select('id, channel_id, video_id').eq('id', id).maybeSingle();
  if (!tip || !(tip as { video_id?: string | null }).video_id) return NextResponse.json({ error: 'Nenalezeno.' }, { status: 404 });
  const owner = (tip as { channel_id: string }).channel_id === user.id;
  let staff = false;
  if (!owner) {
    const { data: me } = await supabaseServer.from('profiles').select('*').eq('id', user.id).maybeSingle();
    const p = (me ?? {}) as { role?: string | null; is_admin?: boolean | null };
    staff = p.role === 'moderator' || p.role === 'admin' || p.is_admin === true;
  }
  if (!owner && !staff) return NextResponse.json({ error: 'Tohle může jen tvůrce videa nebo moderátor.' }, { status: 403 });
  const { error } = await supabaseServer.from('live_tips').update({ hidden_at: body?.hidden === false ? null : new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
