export type Block = { type: 'long' | 'sparks'; items: any[] };

export const RECOMMENDATION_POOL_SIZE = 300;
export const PAGE_SIZE = 40;
const CHUNK_LONG = 4;
const CHUNK_SPARKS = 5;

export function formatDuration(seconds: number | null) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Appka tady videím počítá "skóre", podle kterého se pak řadí - není to
// čistě podle data nahrání. Zohledňuje: čerstvost videa, jestli je to od
// odebíraného kanálu, jestli sedí kategorie/hashtagy k tomu, co uživatel
// v poslední době sledoval, popularitu (zhlédnutí) a kousek náhody (ať
// feed není pořád úplně stejný). Videa, která už uživatel viděl, appka
// výrazně stáhne níž, ale úplně je neschovává.
export function scoreVideo(
  video: any,
  ctx: {
    subscribedIds: Set<string>;
    watchedIds: Set<string>;
    topCategories: Set<string>;
    topHashtags: Set<string>;
  }
) {
  const ageDays = (Date.now() - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-ageDays / 10) * 40;
  const popularityScore = Math.log10((video.views ?? 0) + 1) * 8;

  const subscriptionBonus = video.owner_id && ctx.subscribedIds.has(video.owner_id) ? 35 : 0;
  const categoryBonus = video.category && ctx.topCategories.has(video.category) ? 20 : 0;

  const hashtagMatches = (video.hashtags ?? []).filter((h: string) => ctx.topHashtags.has(h)).length;
  const hashtagBonus = Math.min(hashtagMatches * 6, 18);

  const watchedPenalty = ctx.watchedIds.has(video.id) ? -50 : 0;
  const jitter = Math.random() * 10;

  return recencyScore + popularityScore + subscriptionBonus + categoryBonus + hashtagBonus + watchedPenalty + jitter;
}

export function buildBlocks(longVideos: any[], sparksVideos: any[], preference: 'short' | 'long'): Block[] {
  const pattern: ('long' | 'sparks')[] =
    preference === 'short' ? ['sparks', 'sparks', 'long'] : ['long', 'long', 'sparks'];

  const blocks: Block[] = [];
  let longIndex = 0;
  let sparksIndex = 0;
  let patternIndex = 0;

  while (longIndex < longVideos.length || sparksIndex < sparksVideos.length) {
    const type = pattern[patternIndex % pattern.length];
    patternIndex++;

    if (type === 'long') {
      const items = longVideos.slice(longIndex, longIndex + CHUNK_LONG);
      longIndex += CHUNK_LONG;
      if (items.length > 0) blocks.push({ type: 'long', items });
    } else {
      const items = sparksVideos.slice(sparksIndex, sparksIndex + CHUNK_SPARKS);
      sparksIndex += CHUNK_SPARKS;
      if (items.length > 0) blocks.push({ type: 'sparks', items });
    }

    // Pojistka proti nekonečné smyčce, kdyby jedna fronta byla prázdná
    if (longIndex >= longVideos.length && sparksIndex >= sparksVideos.length) break;
  }

  return blocks;
}
