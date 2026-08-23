export type Block = { type: 'long' | 'sparks'; items: any[] };

/**
 * Kolik videí si hlavní stránka řekne najednou.
 *
 * Dřív tu byl pevný strop: appka stáhla 300 nejnovějších videí, seřadila si
 * je v prohlížeči a tím to skončilo. Mělo to dvě vady - nekonečné scrollování
 * došlo u třístého videa a starší video se nahoru nedostalo nikdy, protože se
 * do těch 300 vůbec nevešlo. Teď se videa berou po dávkách přímo z databáze,
 * takže strop není žádný a prohlížeč nemusí naráz zpracovat celý balík.
 *
 * Osmačtyřicítka se beze zbytku dělí dvanácti (dávka dlouhých videí mezi
 * pruhy Sparks) i šesti (dávka Sparks).
 */
export const FEED_BATCH = 48;

/**
 * Kolik posledních zhlédnutí se bere v potaz při "tohle už jsi viděl".
 *
 * Celá historie se stahovat nedá: databáze vrátí nanejvýš tisíc řádků a
 * navíc bez určeného pořadí, takže po tisícovce zhlédnutých videí by se
 * penalizace u starších tiše rozbila a feed by začal recyklovat.
 */
export const WATCHED_HISTORY_LIMIT = 500;
// Kolik videí je v jedné dávce mezi pruhy Sparks. Dvanáctka se beze zbytku
// rozpadne na řádky po 1, 2, 3, 4 i 6 kartách - dřívější čtyřka nechávala
// na širokém monitoru vpravo prázdné sloupce.
const CHUNK_LONG = 12;
const CHUNK_SPARKS = 6;

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
  // Střídání dlouhých videí a Sparks. Dřív tu byly dvě dávky dlouhých za
  // sebou - jenže od chvíle, co má dávka dvanáct videí místo čtyř, by
  // Sparks naskočily až po čtyřiadvaceti videích, takže na malém kanálu
  // nebyly na hlavní stránce vidět vůbec. Teď přijde pruh Sparks hned
  // po první dávce.
  const pattern: ('long' | 'sparks')[] =
    preference === 'short' ? ['sparks', 'long'] : ['long', 'sparks'];

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
