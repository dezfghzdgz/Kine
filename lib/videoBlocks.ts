export type VideoBlock = { type: 'long' | 'sparks'; items: any[] };

// Kolik videí je v jedné dávce mezi pruhy Sparks.
//
// Dřív tu byla čtyřka - jenže na širokém monitoru se do řádku vejde klidně
// šest karet, takže dávka o čtyřech nechala dva sloupce prázdné a vpravo
// zůstala velká díra. Dvanáctka se beze zbytku rozpadne na řádky po 1, 2,
// 3, 4 i 6 kartách, takže řádky vycházejí zaplněné na všech šířkách.
const CHUNK_LONG = 12;
const CHUNK_SPARKS = 6;

export function isSpark(video: any): boolean {
  return !!(video.height && video.width && video.height > video.width && (video.duration_seconds ?? 0) <= 120);
}

export function buildVideoBlocks(
  allVideos: any[],
  preference: 'short' | 'long' = 'long'
): VideoBlock[] {
  const sparksVideos = allVideos.filter(isSpark);
  const longVideos = allVideos.filter((v) => !isSpark(v));

  // Pruh Sparks přijde hned po první dávce dlouhých videí. Dvě dávky za
  // sebou by při dvanácti videích znamenaly, že se Sparks na malém kanálu
  // vůbec neukážou.
  const pattern: ('long' | 'sparks')[] =
    preference === 'short' ? ['sparks', 'long'] : ['long', 'sparks'];

  const blocks: VideoBlock[] = [];
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

    if (longIndex >= longVideos.length && sparksIndex >= sparksVideos.length) break;
  }

  return blocks;
}
