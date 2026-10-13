import { supabaseServer } from './supabaseServer';
import { isSpark } from './videoBlocks';
import { badgeKey, computeBadges, mergeSeen, unseenBadges, type Badge, type BadgeStats } from './badges';

/**
 * Oznámení o nově odemčeném odznaku (lib/badges.ts).
 *
 * Kine si u profilu pamatuje, o kterých odznacích tvůrce už ví
 * (profiles.badges_seen - migrace supabase-migration-odznaky.sql). Kontrolu
 * spouští prohlížeč přihlášeného (components/BadgeWatcher.tsx) nejvýš jednou
 * za pár desítek minut; počítá se tady, na serveru, ze stejných čísel jako na
 * kanálu - zveřejněná vlastní videa (ne soukromá, ne naplánovaná do budoucna),
 * jejich zhlédnutí, odběratelé, Sparks, vysílání.
 *
 * První kontrola po zavedení odznaků nic nehlásí po jednom (kdo má pět
 * odznaků, dostal by pět oznámení naráz) - pošle jedno "máš N odznaků, vyber
 * si až tři". Bez migrace (sloupec chybí) se nic neposílá: nebylo by kam
 * zapsat, že už oznámeno, a oznámení by chodila pořád dokola.
 */

const PAGE = 1000;
const MAX_PAGES = 10;
/** Od tolika nových odznaků naráz jde jedno souhrnné oznámení. */
const MANY_AT_ONCE = 3;

/** Počet řádků (head + count) - při chybě (chybějící tabulka, sloupec) 0, odznaky kvůli tomu nespadnou. */
async function countOf(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query;
    return error ? 0 : count ?? 0;
  } catch {
    return 0;
  }
}

type VideoRow = { views: number | null; width: number | null; height: number | null; duration_seconds: number | null; scheduled_at: string | null; live_started_at?: string | null };

/** Vlastní videa (připravená, ne soukromá) - po stránkách; se sloupcem live_started_at, když ho databáze má. */
async function ownVideos(userId: string): Promise<VideoRow[] | null> {
  const load = async (withLive: boolean): Promise<{ rows: VideoRow[]; error: boolean }> => {
    const rows: VideoRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabaseServer
        .from('videos')
        .select(withLive ? 'views, width, height, duration_seconds, scheduled_at, live_started_at' : 'views, width, height, duration_seconds, scheduled_at')
        .eq('owner_id', userId)
        .eq('status', 'ready')
        .neq('visibility', 'private')
        .order('created_at', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) return { rows, error: true };
      rows.push(...((data ?? []) as unknown as VideoRow[]));
      if (!data || data.length < PAGE) break;
    }
    return { rows, error: false };
  };
  const full = await load(true);
  if (!full.error) return full.rows;
  const basic = await load(false);
  return basic.error ? null : basic.rows;
}

/**
 * Čísla pro odznaky (lib/badges.ts): zveřejněná vlastní videa (ne soukromá,
 * ne naplánovaná do budoucna), jejich zhlédnutí a lajky, nejsledovanější
 * video, odběratelé, Sparks, vysílání (hodiny), příspěvky, napsané
 * komentáře a přijaté spolupráce. Počítá server (service role) - kanál
 * (/api/badges/stats) i kontrola nových odznaků (checkBadges) z téhož.
 */
export async function badgeStatsFor(userId: string, joinedAt: string | null, now = Date.now()): Promise<BadgeStats | null> {
  const rows = await ownVideos(userId);
  if (!rows) return null;
  const published = rows.filter((v) => !v.scheduled_at || Date.parse(v.scheduled_at) <= now);
  const [subs, streamed, likes, posts, comments, collabs, liveSeconds] = await Promise.all([
    supabaseServer.from('subscriptions').select('*', { count: 'exact', head: true }).eq('channel_id', userId),
    countOf(supabaseServer.from('videos').select('id', { count: 'exact', head: true }).eq('owner_id', userId).not('live_started_at', 'is', null)),
    // Lajky u vlastních videí (jedním dotazem přes vztah reakce -> video).
    countOf(
      supabaseServer
        .from('video_reactions')
        .select('video_id, videos!inner(owner_id)', { count: 'exact', head: true })
        .eq('reaction', 'like')
        .eq('videos.owner_id', userId)
    ),
    countOf(supabaseServer.from('posts').select('id', { count: 'exact', head: true }).eq('owner_id', userId)),
    countOf(supabaseServer.from('comments').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
    countOf(supabaseServer.from('video_collaborators').select('video_id', { count: 'exact', head: true }).eq('profile_id', userId).eq('status', 'accepted')),
    // Odvysílané vteřiny (sloupec z migrace posty-ankety; bez ní 0).
    (async () => {
      const { data, error } = await supabaseServer.from('profiles').select('live_seconds').eq('id', userId).maybeSingle();
      return error ? 0 : Number((data as { live_seconds?: number | null } | null)?.live_seconds) || 0;
    })(),
  ]);
  if (subs.error) return null;
  // Hodiny živě: počítadlo vysílání, nebo aspoň zveřejněné záznamy (dřívější vysílání, než počítadlo vzniklo).
  const recordedSeconds = rows.filter((v) => v.live_started_at).reduce((sum, v) => sum + (Number(v.duration_seconds) || 0), 0);
  return {
    joinedAt,
    videos: published.length,
    views: published.reduce((sum, v) => sum + (Number(v.views) || 0), 0),
    subscribers: subs.count ?? 0,
    sparks: published.filter((v) => isSpark(v)).length,
    // Bez sloupce live_started_at (starší databáze) = nevysílal.
    streamed: streamed > 0,
    likes,
    topVideoViews: published.reduce((max, v) => Math.max(max, Number(v.views) || 0), 0),
    streamHours: Math.max(liveSeconds, recordedSeconds) / 3600,
    posts,
    comments,
    collabs,
  };
}

export type BadgeCheckResult =
  | { ok: true; fresh: Badge[]; first: boolean; total: number }
  | { ok: false; reason: 'migration' | 'not-found' | 'stats' | 'busy' };

/** Text oznámení: stroj čitelný, přeloží si ho prohlížeč (components/NotificationBell.tsx). */
export function badgeNotificationMessage(badge: Badge): string {
  return `badge:${badge.id}:${badge.value}`;
}

export async function checkBadges(userId: string, now = Date.now()): Promise<BadgeCheckResult> {
  const profile = await supabaseServer.from('profiles').select('created_at, badges_seen').eq('id', userId).maybeSingle();
  if (profile.error) return { ok: false, reason: 'migration' };
  if (!profile.data) return { ok: false, reason: 'not-found' };

  const stats = await badgeStatsFor(userId, (profile.data as any).created_at ?? null, now);
  if (!stats) return { ok: false, reason: 'stats' };
  const earned = computeBadges(stats, now);
  const rawSeen = (profile.data as any).badges_seen;
  const seen: string[] | null = Array.isArray(rawSeen) ? rawSeen.filter((k: unknown): k is string => typeof k === 'string') : null;

  const fresh = seen === null ? [] : unseenBadges(earned, seen);
  const nextSeen = mergeSeen(seen ?? [], earned);
  if (seen !== null && fresh.length === 0) {
    // Nic nového; zapamatovat jen, když se seznam změnil (třeba nový stupeň bez oznámení se nestane, ale pro jistotu).
    return { ok: true, fresh: [], first: false, total: earned.length };
  }

  // Zapsat "už ví" jen tehdy, když se od přečtení nic nezměnilo - dvě karty naráz tak
  // nepošlou totéž oznámení dvakrát (druhá zápis nedostane a nic neposílá).
  let update = supabaseServer.from('profiles').update({ badges_seen: nextSeen }).eq('id', userId);
  update = seen === null ? update.is('badges_seen', null) : update.eq('badges_seen', `{${seen.map((k) => `"${k.replace(/["\\]/g, '')}"`).join(',')}}`);
  const { data: written, error } = await update.select('id');
  if (error) return { ok: false, reason: 'migration' };
  if (!written || written.length === 0) return { ok: false, reason: 'busy' };

  const link = `/channel/${userId}?badges=1`;
  if (seen === null) {
    if (earned.length > 0) {
      await supabaseServer.from('notifications').insert({ user_id: userId, type: 'badge', message: `badges:${earned.length}`, link });
    }
    return { ok: true, fresh: [], first: true, total: earned.length };
  }
  if (fresh.length >= MANY_AT_ONCE) {
    // Víc odznaků naráz (nové řady, velký skok): jedno oznámení místo hromady.
    await supabaseServer.from('notifications').insert({ user_id: userId, type: 'badge', message: `badges-new:${fresh.length}`, link });
  } else if (fresh.length > 0) {
    await supabaseServer.from('notifications').insert(fresh.map((b) => ({ user_id: userId, type: 'badge', message: badgeNotificationMessage(b), link })));
  }
  return { ok: true, fresh, first: false, total: earned.length };
}

export { badgeKey };
