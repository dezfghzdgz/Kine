import { supabaseServer } from './supabaseServer';
import type { ChatRoom } from './liveChat';
import { DEFAULT_CHAT_SETTINGS, sanitizeChatSettings, type ChatSettings } from './liveChatRules';

/**
 * Moderace chatu - databázová část (pravidla jsou v lib/liveChatRules.ts).
 *
 * Kdo smí moderovat chat kanálu: majitel, moderátoři Kine (role moderator
 * / admin) a moderátoři, které si majitel kanálu sám přidal
 * (channel_moderators) - streamer tak nemusí mazat spam uprostřed hry.
 * Tabulky zakládá supabase-migration-zive-2.sql; bez ní chat funguje
 * dál, jen bez nových pravidel.
 */

export type ChatRole = 'owner' | 'staff' | 'moderator' | 'viewer';

export async function roomOwnerId(room: ChatRoom): Promise<string | null> {
  if (room.kind === 'channel') return room.id;
  const { data } = await supabaseServer.from('videos').select('owner_id').eq('id', room.id).maybeSingle();
  return (data?.owner_id as string | undefined) ?? null;
}

export async function chatRole(userId: string, room: ChatRoom, ownerIdKnown?: string | null): Promise<{ role: ChatRole; ownerId: string | null }> {
  const ownerId = ownerIdKnown !== undefined ? ownerIdKnown : await roomOwnerId(room);
  if (ownerId && ownerId === userId) return { role: 'owner', ownerId };
  const [me, mod] = await Promise.all([
    supabaseServer.from('profiles').select('role').eq('id', userId).maybeSingle(),
    ownerId
      ? supabaseServer.from('channel_moderators').select('user_id').eq('channel_id', ownerId).eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const siteRole = (me.data as { role?: string } | null)?.role;
  if (siteRole === 'moderator' || siteRole === 'admin') return { role: 'staff', ownerId };
  if (mod.data) return { role: 'moderator', ownerId };
  return { role: 'viewer', ownerId };
}

export async function loadChatSettings(roomKey: string): Promise<{ settings: ChatSettings; available: boolean }> {
  const { data, error } = await supabaseServer.from('live_chat_settings').select('*').eq('room', roomKey).maybeSingle();
  if (error) return { settings: { ...DEFAULT_CHAT_SETTINGS }, available: false };
  return { settings: data ? sanitizeChatSettings(data) : { ...DEFAULT_CHAT_SETTINGS }, available: true };
}

export async function saveChatSettings(roomKey: string, settings: ChatSettings): Promise<string | null> {
  const { error } = await supabaseServer.from('live_chat_settings').upsert(
    {
      room: roomKey,
      slow_seconds: settings.slowSeconds,
      followers_only: settings.followersOnly,
      follow_minutes: settings.followMinutes,
      block_links: settings.blockLinks,
      blocked_terms: settings.blockedTerms,
      min_account_minutes: settings.minAccountMinutes,
      shield: settings.shield,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'room' }
  );
  return error ? error.message : null;
}

/** Platný zákaz / ztlumení (until null = napořád), nebo null. */
export async function activeBan(roomKey: string, userId: string): Promise<{ until: number | null } | null> {
  const { data, error } = await supabaseServer.from('live_chat_bans').select('until').eq('room', roomKey).eq('user_id', userId).maybeSingle();
  if (error || !data) return null;
  const until = data.until ? new Date(data.until as string).getTime() : null;
  if (until !== null && until <= Date.now()) return null;
  return { until };
}

/** Jména k id (dva jednoduché dotazy místo vnořeného - ten když selže, vrátí tiše prázdno). */
async function usernames(ids: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (ids.length === 0) return map;
  const { data } = await supabaseServer.from('profiles').select('id, username').in('id', ids);
  for (const p of (data ?? []) as { id: string; username: string | null }[]) map.set(p.id, p.username);
  return map;
}

/** Kdo má v chatu zrovna zákaz nebo ztlumení (pro moderátory). */
export async function listBans(roomKey: string): Promise<{ userId: string; username: string | null; until: string | null }[]> {
  const { data, error } = await supabaseServer
    .from('live_chat_bans')
    .select('user_id, until')
    .eq('room', roomKey)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) return [];
  const now = Date.now();
  const active = (data as { user_id: string; until: string | null }[]).filter((b) => !b.until || new Date(b.until).getTime() > now);
  const names = await usernames(active.map((b) => b.user_id));
  return active.map((b) => ({ userId: b.user_id, username: names.get(b.user_id) ?? null, until: b.until ?? null }));
}

export async function listModerators(channelId: string): Promise<{ userId: string; username: string | null }[]> {
  const { data, error } = await supabaseServer
    .from('channel_moderators')
    .select('user_id')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  const ids = (data as { user_id: string }[]).map((m) => m.user_id);
  const names = await usernames(ids);
  return ids.map((id) => ({ userId: id, username: names.get(id) ?? null }));
}
