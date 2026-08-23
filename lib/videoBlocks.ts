export type VideoBlock = { type: 'long' | 'sparks'; items: any[] };

// Kolik videí je v jedné dávce mezi pruhy Sparks.
//
// Dřív tu byla čtyřka - jenže na širokém monitoru se do řádku vejde klidně
// šest karet, takže dávka o čtyřech nechala dva sloupce prázdné a vpravo
// zůstala velká díra. Dvanáctka se beze zbytku rozpadne na řádky po 1, 2,
// 3, 4 i 6 kartách, takže řádky vycházejí zaplněné na všech šířkách.
const CHUNK_LONG = 12;
const CHUNK_SPARKS = 6;

// Do pruhu Sparks se počítá video na výšku do dvou minut. Číslo i pravidlo
// jsou schválně na jednom místě - dřív se stejná podmínka opisovala zvlášť
// na hlavní stránce, v Exploreru, na kanálu i v samotných Sparks, takže
// stačilo jedno místo opravit a stránky si přestaly odpovídat.
export const SPARK_MAX_SECONDS = 120;

export function isSpark(video: any): boolean {
  return !!(
    video.height &&
    video.width &&
    video.height > video.width &&
    (video.duration_seconds ?? 0) <= SPARK_MAX_SECONDS
  );
}

/**
 * Videa, kterým do Sparks chybí jen kousek.
 *
 * Když se pruh Sparks neukáže, bývá to skoro vždycky jedním z těchhle dvou
 * důvodů: video na výšku je delší než dvě minuty, nebo u něj v databázi
 * chybí rozměry (starší nahrávky před migrací, která width/height přidala).
 * Bez rozměrů se video nemá jak poznat, takže se veze mezi běžnými videi.
 */
export function nearMissSparks(videos: any[]) {
  let portraitTooLong = 0;
  let missingDimensions = 0;

  for (const video of videos) {
    if (!video.width || !video.height) {
      missingDimensions++;
      continue;
    }
    if (video.height > video.width && (video.duration_seconds ?? 0) > SPARK_MAX_SECONDS) {
      portraitTooLong++;
    }
  }

  return { portraitTooLong, missingDimensions };
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
