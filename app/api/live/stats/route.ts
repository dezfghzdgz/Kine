import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isMissingTable, userFromRequest } from '@/lib/apiUser';
import { channelRoom } from '@/lib/liveChat';
import { averageViewers, cachedLiveViewers, sessionDurationS, type LiveSessionStats } from '@/lib/liveStats';

export const dynamic = 'force-dynamic';

/**
 * Statistiky živého vysílání tvůrce (Statistiky kanálu -> Živé vysílání).
 *
 * Posledních 20 vysílání: délka, nejvíc a průměrně diváků (vzorky z
 * lib/liveStats.ts), zprávy v chatu a podpory během vysílání. Vidí je jen
 * majitel kanálu (přihlášení + RLS na live_sessions; server čte jen řádky
 * přihlášeného). Odpověď si server pro jednoho tvůrce 20 s pamatuje - stránka
 * statistik se dá obnovovat, ale databázi to nezatíží.
 */

type SessionRow = {
  id: string;
  started_at: string;
  last_seen_at: string;
  title: string | null;
  peak_viewers: number | null;
  viewer_sum: number | null;
  viewer_samples: number | null;
};

type Payload = {
  enabled: boolean;
  hasStream: boolean;
  current: { startedAt: string | null; viewers: number | null; title: string } | null;
  sessions: LiveSessionStats[];
  totals: { sessions: number; seconds: number; peakViewers: number; chatMessages: number; tips: Record<string, { count: number; cents: number }> };
};

const MEMO_MS = 20 * 1000;
const memo = new Map<string, { at: number; payload: Payload }>();
/** Chat a podpory chvíli po posledním vzorku ještě patří k vysílání (vzorek je jednou za minutu). */
const TAIL_MS = 2 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const noStore = { headers: { 'Cache-Control': 'private, no-store' } };

  const hit = memo.get(user.id);
  if (hit && Date.now() - hit.at < MEMO_MS) return NextResponse.json(hit.payload, noStore);

  const [sessionsRes, streamRes] = await Promise.all([
    supabaseServer
      .from('live_sessions')
      .select('id, started_at, last_seen_at, title, peak_viewers, viewer_sum, viewer_samples')
      .eq('owner_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20),
    supabaseServer.from('live_streams').select('is_live, started_at, title, cf_input_id').eq('owner_id', user.id).maybeSingle(),
  ]);

  const stream = streamRes.error ? null : (streamRes.data as { is_live: boolean; started_at: string | null; title: string | null; cf_input_id: string | null } | null);
  const current =
    stream?.is_live
      ? { startedAt: stream.started_at, viewers: await cachedLiveViewers(stream.cf_input_id), title: String(stream.title ?? '') }
      : null;

  if (sessionsRes.error) {
    if (isMissingTable(sessionsRes.error)) {
      return NextResponse.json({ enabled: false, hasStream: !!stream, current, sessions: [], totals: emptyTotals() } satisfies Payload, noStore);
    }
    console.error('Kine: /api/live/stats', sessionsRes.error.message);
    return NextResponse.json({ error: 'Statistiky se teď nepodařilo načíst.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const rows = (sessionsRes.data ?? []) as SessionRow[];
  const room = channelRoom(user.id);
  const oldest = rows.length ? rows[rows.length - 1].started_at : null;

  // Zprávy v chatu: jeden počet na vysílání (index room + čas).
  const chatCounts = await Promise.all(
    rows.map(async (r) => {
      const until = new Date(Date.parse(r.last_seen_at) + TAIL_MS).toISOString();
      const { count, error } = await supabaseServer
        .from('live_chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('room', room)
        .gte('created_at', r.started_at)
        .lte('created_at', until);
      return error ? null : count ?? 0;
    })
  );

  // Podpory ve vysílání (ne Super díky pod videi): jedním dotazem, pak se rozdělí podle času.
  type TipRow = { amount_cents: number; currency: string; paid_at: string };
  let tips: TipRow[] | null = null;
  if (oldest) {
    const base = () =>
      supabaseServer
        .from('live_tips')
        .select('amount_cents, currency, paid_at')
        .eq('channel_id', user.id)
        .eq('status', 'paid')
        .gte('paid_at', oldest)
        .limit(5000);
    let res = await base().is('video_id', null);
    if (res.error && /video_id/i.test(res.error.message ?? '')) res = await base();
    tips = res.error ? null : ((res.data ?? []) as TipRow[]);
  }

  const totals = emptyTotals();
  const sessions: LiveSessionStats[] = rows.map((r, i) => {
    const start = Date.parse(r.started_at);
    const end = Date.parse(r.last_seen_at) + TAIL_MS;
    let tipSummary: LiveSessionStats['tips'] = null;
    if (tips) {
      const byCurrency: Record<string, number> = {};
      let count = 0;
      for (const t of tips) {
        const at = Date.parse(t.paid_at);
        if (!(at >= start && at <= end)) continue;
        const cents = Number(t.amount_cents) || 0;
        count += 1;
        byCurrency[t.currency] = (byCurrency[t.currency] ?? 0) + cents;
        const sum = (totals.tips[t.currency] ??= { count: 0, cents: 0 });
        sum.count += 1;
        sum.cents += cents;
      }
      tipSummary = { count, byCurrency };
    }
    const session: LiveSessionStats = {
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.last_seen_at,
      durationS: sessionDurationS(r.started_at, r.last_seen_at),
      title: String(r.title ?? ''),
      peakViewers: Math.max(0, Number(r.peak_viewers) || 0),
      avgViewers: averageViewers(Number(r.viewer_sum) || 0, Number(r.viewer_samples) || 0),
      chatMessages: chatCounts[i],
      tips: tipSummary,
    };
    totals.sessions += 1;
    totals.seconds += session.durationS;
    totals.peakViewers = Math.max(totals.peakViewers, session.peakViewers);
    totals.chatMessages += session.chatMessages ?? 0;
    return session;
  });

  const payload: Payload = { enabled: true, hasStream: !!stream, current, sessions, totals };
  memo.set(user.id, { at: Date.now(), payload });
  if (memo.size > 1000) {
    for (const [k, v] of memo) if (Date.now() - v.at > MEMO_MS) memo.delete(k);
  }
  return NextResponse.json(payload, noStore);
}

function emptyTotals(): Payload['totals'] {
  return { sessions: 0, seconds: 0, peakViewers: 0, chatMessages: 0, tips: {} };
}
