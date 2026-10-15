import { supabaseServer } from './supabaseServer';
import { isMissingTable } from './apiUser';
import { MAX_CHANNEL_EMOTES, type ChatEmote } from './chatEmotes';

/**
 * Emoty kanálu z databáze (tabulka channel_emotes z migrace
 * supabase-migration-chat-emoty.sql). Jen na serveru; prohlížeč je dostane
 * přes /api/live/chat/emotes.
 */

type Row = { id: string; code: string; image_url: string; animated: boolean | null };

export async function listChannelEmotes(channelId: string): Promise<{ emotes: ChatEmote[]; available: boolean }> {
  const { data, error } = await supabaseServer
    .from('channel_emotes')
    .select('id, code, image_url, animated')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(MAX_CHANNEL_EMOTES);
  if (error) return { emotes: [], available: !isMissingTable(error) };
  const emotes = ((data ?? []) as Row[]).map((r) => ({ id: r.id, code: r.code, url: r.image_url, channel: true, ...(r.animated ? { animated: true } : {}) }));
  return { emotes, available: true };
}

/** Jen seznam (bez migrace nebo při chybě prázdný). */
export async function loadChannelEmotes(channelId: string): Promise<ChatEmote[]> {
  return (await listChannelEmotes(channelId)).emotes;
}
