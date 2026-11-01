/**
 * Co appka o videu už ví z karty, na kterou divák klikl (název, náhled,
 * tvar) - stránka videa to ukáže hned, ještě než dojdou údaje z databáze.
 *
 * Bez toho stránka po kliknutí na chvíli zmizela: místo videa jen
 * "Načítání…" na tmavém pozadí a pak naskočilo všechno najednou ("celá
 * stránka zčerná a blikne"). Teď je na místě přehrávače rovnou náhled
 * videa s kolečkem a nad ním název - a skutečná stránka ho vystřídá na
 * stejném místě.
 *
 * Jen v paměti prohlížeče (žádné úložiště), pár desítek posledních karet.
 */

export type VideoPeek = {
  id: string;
  title: string | null;
  thumbnail: string | null;
  vertical: boolean;
  creator: string | null;
};

const MAX = 60;
const peeks = new Map<string, VideoPeek>();

/** Zapamatuje kartu (klik, najetí myší). Cokoli neúplného se tiše přeskočí. */
export function rememberVideoPeek(video: any): void {
  const id = typeof video?.id === 'string' ? video.id : null;
  if (!id || id.length > 64) return;
  const thumbnail = typeof video.thumbnail_url === 'string' && /^https?:\/\//.test(video.thumbnail_url) ? video.thumbnail_url : null;
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const profiles = Array.isArray(video.profiles) ? video.profiles[0] : video.profiles;
  peeks.delete(id);
  peeks.set(id, {
    id,
    title: typeof video.title === 'string' ? video.title.slice(0, 300) : null,
    thumbnail,
    vertical: width > 0 && height > width,
    creator: typeof profiles?.username === 'string' ? profiles.username : null,
  });
  while (peeks.size > MAX) {
    const oldest = peeks.keys().next().value;
    if (oldest === undefined) break;
    peeks.delete(oldest);
  }
}

export function videoPeek(id: string | null | undefined): VideoPeek | null {
  if (!id) return null;
  return peeks.get(id) ?? null;
}
