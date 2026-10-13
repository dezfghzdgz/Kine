/** Výchozí barva playlistu v databázi (playlists.color default) = barvu nikdo nevybral. */
export const DEFAULT_PLAYLIST_COLOR = '#3a3a40';

/** Vybral si tvůrce barvu sám (jinou než výchozí šedou)? Pak má přednost před náhledem videa. */
export function hasChosenColor(color: string | null | undefined): boolean {
  return !!color && color.trim().toLowerCase() !== DEFAULT_PLAYLIST_COLOR;
}

/**
 * Obal playlistu: vlastní obrázek; jinak vybraná barva (vrací null - karta ji
 * ukáže); jinak náhled prvního videa (jako na YouTube); jinak null (výchozí
 * barva). Řádky playlist_videos musí přijít i s pozicí a vnořeným videem:
 * playlist_videos(video_id, position, videos(thumbnail_url)).
 */
export function playlistCover(p: { thumbnail_url?: string | null; color?: string | null; playlist_videos?: unknown }): string | null {
  if (p.thumbnail_url) return p.thumbnail_url;
  if (hasChosenColor(p.color)) return null;
  const items = Array.isArray(p.playlist_videos) ? [...(p.playlist_videos as any[])] : [];
  items.sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0));
  for (const item of items) {
    const video = Array.isArray(item?.videos) ? item.videos[0] : item?.videos;
    if (video?.thumbnail_url) return video.thumbnail_url as string;
  }
  return null;
}
