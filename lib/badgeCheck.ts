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

/** Čísla pro odznaky - stejná pravidla jako app/channel/[id]/page.tsx. */
export async function badgeStatsFor(userId: string, joinedAt: string | null, now = Date.now()): Promise<BadgeStats | null> {
  const rows: { views: number | null; width: number | null; height: number | null; duration_seconds: number | null; scheduled_at: string | null }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabaseServer
      .from('videos')
      .select('views, width, height, duration_seconds, scheduled_at')
      .eq('owner_id', userId)
      .eq('status', 'ready')
      .neq('visibility', 'private')
      .order('created_at', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return null;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < PAGE) break;
  }
  const published = rows.filter((v) => !v.scheduled_at || Date.parse(v.scheduled_at) <= now);
  const [subs, streamed] = await Promise.all([
    supabaseServer.from('subscriptions').select('*', { count: 'exact', head: true }).eq('channel_id', userId),
    supabaseServer.from('videos').select('id', { count: 'exact', head: true }).eq('owner_id', userId).not('live_started_at', 'is', null),
  ]);
  if (subs.error) return null;
  return {
    joinedAt,
    videos: published.length,
    views: published.reduce((sum, v) => sum + (Number(v.views) || 0), 0),
    subscribers: subs.count ?? 0,
    sparks: published.filter((v) => isSpark(v)).length,
    // Bez sloupce live_started_at (starší databáze) = nevysílal.
    streamed: !streamed.error && (streamed.count ?? 0) > 0,
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
  if (fresh.length > 0) {
    await supabaseServer.from('notifications').insert(fresh.map((b) => ({ user_id: userId, type: 'badge', message: badgeNotificationMessage(b), link })));
  }
  return { ok: true, fresh, first: false, total: earned.length };
}

export { badgeKey };
