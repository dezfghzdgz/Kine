export type VideoBlock = { type: 'long' | 'sparks'; items: any[] };

const CHUNK_LONG = 4;
const CHUNK_SPARKS = 5;

export function isSpark(video: any): boolean {
  return !!(video.height && video.width && video.height > video.width && (video.duration_seconds ?? 0) <= 120);
}

export function buildVideoBlocks(
  allVideos: any[],
  preference: 'short' | 'long' = 'long'
): VideoBlock[] {
  const sparksVideos = allVideos.filter(isSpark);
  const longVideos = allVideos.filter((v) => !isSpark(v));

  const pattern: ('long' | 'sparks')[] =
    preference === 'short' ? ['sparks', 'sparks', 'long'] : ['long', 'long', 'sparks'];

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
