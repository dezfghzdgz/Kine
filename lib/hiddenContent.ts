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

/**
 * Kdo video nahrál.
 *
 * Supabase vrací navázaný profil jednou jako objekt a jindy jako pole -
 * podle toho, jak je vazba v dotazu napsaná. Bereme obojí, ať se na tom
 * volající nemusí trápit.
 */
function ownerIdOf(video: any): string | undefined {
  if (video?.owner_id) return video.owner_id;
  const profiles = video?.profiles;
  if (Array.isArray(profiles)) return profiles[0]?.id;
  return profiles?.id;
}

/**
 * Vyhodí ze seznamu videa, která si divák (nebo jejichž kanál) schoval.
 *
 * Typ videa se schválně nijak neomezuje: každá stránka si z databáze tahá
 * jiné sloupce, takže jakékoliv přesnější omezení by se s některým z těch
 * tvarů rozešlo a build by spadl. Funkce vrátí přesně ten typ, který
 * dostala.
 */
export function filterHidden<T>(videos: T[], hidden: HiddenContent): T[] {
  if (hidden.videoIds.size === 0 && hidden.channelIds.size === 0) return videos;

  return videos.filter((video) => {
    const id = (video as any)?.id;
    if (id && hidden.videoIds.has(id)) return false;

    const owner = ownerIdOf(video);
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

/**
 * Vrátí zpátky všechno schované najednou.
 *
 * "Nezajímá mě" byla do teď jednosměrka - kliknutím video zmizelo z
 * doporučení a nikde v appce nebylo, jak si ho vrátit. Odsud to jde jedním
 * tlačítkem přímo z hlavní stránky.
 */
export async function clearHiddenContent(userId: string) {
  await Promise.all([
    supabase.from('hidden_videos').delete().eq('user_id', userId),
    supabase.from('hidden_channels').delete().eq('user_id', userId),
  ]);
}
