import { supabaseServer } from './supabaseServer';

/**
 * Nový příspěvek -> oznámení odběratelům se zvonečkem (jako u nového videa).
 * Jen jednou: kdo první zapíše posts.notified_at, ten posílá (migrace
 * supabase-migration-posty-ankety.sql; bez ní se nic neposílá). Zablokovaný
 * / shadow-banovaný kanál nic nehlásí. Volá /api/posts/notify (web hned po
 * zveřejnění příspěvku).
 */
export async function notifyNewPost(post: { id: string; owner_id: string; content: string | null }): Promise<{ ok: boolean; sent?: number; reason?: string }> {
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

  const name = profile?.display_name || profile?.username || 'Kanál';
  const text = String(post.content ?? '').replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 90 ? `${text.slice(0, 87)}…` : text;
  const message = excerpt ? `${name}: ${excerpt}` : name;
  const rows = subs.map((s: { subscriber_id: string }) => ({ user_id: s.subscriber_id, type: 'new_post', message, link: `/post/${post.id}` }));
  // Po dávkách - kanál s tisíci odběrateli nesmí narazit na strop jednoho dotazu.
  let sent = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseServer.from('notifications').insert(rows.slice(i, i + 500));
    if (error) break;
    sent += Math.min(500, rows.length - i);
  }
  return { ok: true, sent };
}
