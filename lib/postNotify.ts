import { supabaseServer } from './supabaseServer';

/** Kolik příspěvků jednoho kanálu za 24 hodin smí poslat oznámení (víc je spam do zvonečků). */
export const POST_NOTIFY_PER_DAY = 5;

/**
 * Nový příspěvek -> oznámení odběratelům se zvonečkem (jako u nového videa).
 * Jen jednou: kdo první zapíše posts.notified_at, ten posílá (migrace
 * supabase-migration-posty-ankety.sql; bez ní se nic neposílá). Zablokovaný
 * / shadow-banovaný kanál nic nehlásí. Volá /api/posts/notify (web hned po
 * zveřejnění příspěvku).
 *
 * Příspěvek jen pro členy dostanou jen členové kanálu (ostatní by viděli
 * úryvek textu, který jim nepatří). Nejvýš POST_NOTIFY_PER_DAY oznámení
 * za den na kanál.
 */
export async function notifyNewPost(post: { id: string; owner_id: string; content: string | null; members_only?: boolean | null }): Promise<{ ok: boolean; sent?: number; reason?: string }> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: notifiedToday } = await supabaseServer
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', post.owner_id)
    .gt('notified_at', since)
    .neq('id', post.id);
  if ((notifiedToday ?? 0) >= POST_NOTIFY_PER_DAY) return { ok: true, sent: 0, reason: 'daily-cap' };

  const claim = await supabaseServer
    .from('posts')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', post.id)
    .is('notified_at', null)
    .select('id');
  if (claim.error) return { ok: false, reason: 'migration' };
  if (!claim.data || claim.data.length === 0) return { ok: false, reason: 'done' };

  const [{ data: subs }, { data: profile }] = await Promise.all([
    supabaseServer.from('subscriptions').select('subscriber_id').eq('channel_id', post.owner_id).eq('notify_new_videos', true),
    supabaseServer.from('profiles').select('username, display_name, is_banned, is_shadow_banned').eq('id', post.owner_id).maybeSingle(),
  ]);
  if (!subs || subs.length === 0) return { ok: true, sent: 0 };
  if (profile?.is_banned || profile?.is_shadow_banned) return { ok: true, sent: 0 };

  // Příspěvek pro členy: jen ti odběratelé se zvonečkem, kteří jsou členy kanálu.
  let recipients = subs as { subscriber_id: string }[];
  if (post.members_only) {
    const { data: members, error: membersError } = await supabaseServer
      .from('channel_subscriptions')
      .select('subscriber_id')
      .eq('creator_id', post.owner_id)
      .in('status', ['active', 'past_due'])
      .limit(50000);
    if (membersError) return { ok: true, sent: 0, reason: 'members' };
    const memberIds = new Set((members ?? []).map((m: { subscriber_id: string }) => m.subscriber_id));
    recipients = recipients.filter((r) => memberIds.has(r.subscriber_id));
    if (recipients.length === 0) return { ok: true, sent: 0 };
  }

  const name = profile?.display_name || profile?.username || 'Kanál';
  const text = String(post.content ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 90 ? `${text.slice(0, 87)}…` : text;
  const message = `${post.members_only ? '🔒 ' : ''}${excerpt ? `${name}: ${excerpt}` : name}`;
  const rows = recipients.map((r) => ({ user_id: r.subscriber_id, type: 'new_post', message, link: `/post/${post.id}` }));
  // Po dávkách - kanál s tisíci odběrateli nesmí narazit na strop jednoho dotazu.
  let sent = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseServer.from('notifications').insert(rows.slice(i, i + 500));
    if (error) break;
    sent += Math.min(500, rows.length - i);
  }
  return { ok: true, sent };
}
