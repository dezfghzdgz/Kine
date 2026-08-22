import { supabase } from './supabaseClient';

/**
 * "Nezajímá mě" a "Nedoporučovat kanál".
 *
 * Divák si může schovat konkrétní video nebo rovnou celý kanál a appka mu
 * ho přestane doporučovat. Seznam je vždycky jen jeho - kdo si co schoval
 * se nikdo jiný, ani tvůrce, nedozví.
 *
 * Tabulky přidává samostatná migrace (supabase-migration-hidden-content.sql).
 * Dokud neproběhne, tyhle funkce se tváří, jako by nebylo schované nic -
 * feed tím pádem funguje dál, jen se schovávání neuloží.
 */

export type HiddenContent = {
  videoIds: Set<string>;
  channelIds: Set<string>;
};

export const NOTHING_HIDDEN: HiddenContent = {
  videoIds: new Set<string>(),
  channelIds: new Set<string>(),
};

export async function loadHiddenContent(userId: string): Promise<HiddenContent> {
  const [videos, channels] = await Promise.all([
    supabase.from('hidden_videos').select('video_id').eq('user_id', userId),
    supabase.from('hidden_channels').select('channel_id').eq('user_id', userId),
  ]);

  return {
    videoIds: new Set((videos.data ?? []).map((r: any) => r.video_id)),
    channelIds: new Set((channels.data ?? []).map((r: any) => r.channel_id)),
  };
}

/** Vyhodí ze seznamu videa, která si divák (nebo jejichž kanál) schoval. */
export function filterHidden<T extends { id: string; owner_id?: string; profiles?: { id?: string } }>(
  videos: T[],
  hidden: HiddenContent
): T[] {
  if (hidden.videoIds.size === 0 && hidden.channelIds.size === 0) return videos;

  return videos.filter((v) => {
    if (hidden.videoIds.has(v.id)) return false;
    const owner = v.owner_id ?? v.profiles?.id;
    return !(owner && hidden.channelIds.has(owner));
  });
}

/**
 * Schová video z doporučení.
 *
 * Zapisuje se přes insert, ne upsert - upsert znamená "když už tam je,
 * přepiš to", což potřebuje zvláštní povolení k úpravě, které tabulka
 * schválně nemá. Když už je video schované, databáze se ozve duplicitou
 * a to je v pořádku, výsledek je stejný.
 */
export async function hideVideo(userId: string, videoId: string) {
  const { error } = await supabase.from('hidden_videos').insert({ user_id: userId, video_id: videoId });
  return { error: isDuplicate(error) ? null : error };
}

function isDuplicate(error: { code?: string } | null) {
  return !!error && (error.code === '23505' || error.code === '23409');
}

export async function unhideVideo(userId: string, videoId: string) {
  return supabase.from('hidden_videos').delete().eq('user_id', userId).eq('video_id', videoId);
}

export async function hideChannel(userId: string, channelId: string) {
  const { error } = await supabase.from('hidden_channels').insert({ user_id: userId, channel_id: channelId });
  return { error: isDuplicate(error) ? null : error };
}

export async function unhideChannel(userId: string, channelId: string) {
  return supabase.from('hidden_channels').delete().eq('user_id', userId).eq('channel_id', channelId);
}
