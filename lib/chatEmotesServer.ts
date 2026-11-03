import { supabaseServer } from './supabaseServer';
import { isMissingTable } from './apiUser';
import { MAX_CHANNEL_EMOTES, type ChatEmote } from './chatEmotes';

/**
 * Emoty kanálu z databáze (tabulka channel_emotes z migrace
 * supabase-migration-chat-emoty.sql). Jen na serveru; prohlížeč je dostane
 * přes /api/live/chat/emotes.
 *
 * Kontrola emotů (sloupec review_status, SQL z dodávky - viz
 * app/api/live/chat/emotes): emote, který server sám zkontrolovat neumí
 * (GIF, WebP, animované PNG), čeká na schválení moderátorem ("pending") a do
 * té doby se v chatu nikomu neukazuje. Bez sloupce jsou všechny emoty schválené
 * (`review: false` - nahrát jde jen to, co server zkontroluje sám).
 */

type Row = { id: string; code: string; image_url: string; animated: boolean | null; review_status?: string | null };

export type ChannelEmote = ChatEmote & { pending?: boolean };

/** Chybí sloupec review_status (migrace kontroly emotů ještě neproběhla)? */
function missingReviewColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /review_status/i.test(error.message ?? ''));
}

export async function listChannelEmotes(
  channelId: string,
  opts: { includePending?: boolean } = {}
): Promise<{ emotes: ChannelEmote[]; available: boolean; review: boolean }> {
  const query = (columns: string) =>
    supabaseServer.from('channel_emotes').select(columns).eq('channel_id', channelId).order('created_at', { ascending: true }).limit(MAX_CHANNEL_EMOTES);
  let review = true;
  let { data, error } = await query('id, code, image_url, animated, review_status');
  if (missingReviewColumn(error)) {
    review = false;
    ({ data, error } = await query('id, code, image_url, animated'));
  }
  if (error) return { emotes: [], available: !isMissingTable(error), review: false };
  const emotes = ((data ?? []) as unknown as Row[])
    .filter((r) => opts.includePending || !review || (r.review_status ?? 'approved') === 'approved')
    .map((r) => ({
      id: r.id,
      code: r.code,
      url: r.image_url,
      channel: true as const,
      ...(r.animated ? { animated: true } : {}),
      ...(review && r.review_status === 'pending' ? { pending: true } : {}),
    }));
  return { emotes, available: true, review };
}

/** Jen schválené emoty (bez migrace nebo při chybě prázdný seznam). */
export async function loadChannelEmotes(channelId: string): Promise<ChatEmote[]> {
  return (await listChannelEmotes(channelId)).emotes;
}
