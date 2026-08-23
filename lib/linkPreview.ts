/**
 * Náhledy odkazů (Open Graph).
 *
 * Když někdo hodí odkaz na video do Discordu, na Facebook nebo do
 * Messengeru, vytáhne si odtamtud název, popis a obrázek. Do teď se
 * všem stránkám appky posílal jeden společný text z app/layout.tsx,
 * takže každý sdílený odkaz vypadal stejně - bez názvu videa a bez
 * náhledu. Tyhle pomůcky používají app/watch/[id]/layout.tsx a
 * app/channel/[id]/layout.tsx.
 */

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/**
 * Zkrácení popisu do délky, kterou sítě reálně zobrazí.
 *
 * Delší text stejně useknou, akorát uprostřed slova - tohle to zkrátí
 * na hranici slova a přidá výpustku.
 */
export function shorten(text: string | null | undefined, max = 180): string | undefined {
  const trimmed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= max) return trimmed;

  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/**
 * Navázaný záznam z databáze.
 *
 * Supabase vrací vazbu jednou jako objekt a jindy jako pole, podle toho,
 * jak je dotaz napsaný. Bereme obojí.
 */
export function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

/** Obrázek náhledu videa - vlastní, jinak snímek přímo z Cloudflare. */
export function videoThumbnail(thumbnailUrl?: string | null, cloudflareId?: string | null) {
  if (thumbnailUrl) return thumbnailUrl;
  if (!cloudflareId) return undefined;
  return `https://videodelivery.net/${cloudflareId}/thumbnails/thumbnail.jpg?time=1s&width=1280`;
}
