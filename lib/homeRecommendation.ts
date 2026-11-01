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
// Pruh Sparks vyplní celou šířku i na širokém monitoru (components/SparksShelf.tsx) - karet musí být dost.
const CHUNK_SPARKS = 12;

export function formatDuration(seconds: number | null) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Hashtagy sledovaných her (lib/games.ts - gameTagSets); slabé platí jen v kategorii Hry. */
export type FollowedGameTags = { gameStrong?: Set<string>; gameWeak?: Set<string> };

/** Je video ze hry, kterou divák sleduje (/game/[slug] - Sledovat)? */
export function fromFollowedGame(video: any, ctx: FollowedGameTags): boolean {
  if (!ctx.gameStrong?.size && !ctx.gameWeak?.size) return false;
  const tags: unknown[] = Array.isArray(video?.hashtags) ? video.hashtags : [];
  const gaming = video?.category === 'catGaming';
  return tags.some((raw) => {
    if (typeof raw !== 'string') return false;
    // Stejně jako lib/games.ts - normalizeGameTag ("Counter-Strike" -> "counterstrike").
    const h = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    return !!ctx.gameStrong?.has(h) || (gaming && !!ctx.gameWeak?.has(h));
  });
}

/**
 * Co o divákovi víme navíc (vše nepovinné - bez toho skóre funguje jako dřív).
 *  - lang: jazyk webu (videa v jeho jazyce dostanou přednost),
 *  - categoryWeights / hashtagWeights: zájmy s vahou 0-1 (čerstvá zhlédnutí váží víc),
 *  - impressions: kolikrát už divák kartu viděl na hlavní stránce a nekliknul (lib/feedImpressions.ts),
 *  - now: pevný čas (testy).
 */
export type ScoreExtras = {
  lang?: string | null;
  categoryWeights?: Map<string, number>;
  hashtagWeights?: Map<string, number>;
  impressions?: (videoId: string) => number;
  now?: number;
};

export type ScoreContext = {
  subscribedIds: Set<string>;
  watchedIds: Set<string>;
  topCategories: Set<string>;
  topHashtags: Set<string>;
} & FollowedGameTags &
  ScoreExtras;

/** Čeština a slovenština si rozumí - napůl jako shoda. */
const CLOSE_LANGUAGES: Record<string, string> = { cs: 'sk', sk: 'cs' };

/** Body za jazyk videa vůči jazyku webu diváka (bez údaje nic). */
export function languageBonus(videoLang: unknown, viewerLang: string | null | undefined): number {
  if (!viewerLang || typeof videoLang !== 'string' || !videoLang) return 0;
  if (videoLang === viewerLang) return 10;
  return CLOSE_LANGUAGES[viewerLang] === videoLang ? 6 : 0;
}

/** Kolik bodů ubere opakované zobrazení bez kliknutí (karta, kterou divák viděl a nechtěl). */
export function impressionPenalty(count: number): number {
  if (!Number.isFinite(count) || count < 2) return 0;
  return -Math.min(36, (Math.floor(count) - 1) * 9);
}

/**
 * Skóre videa pro hlavní stránku - podle něj se řadí (ne čistě podle data).
 *
 * Složky: čerstvost, popularita (logaritmicky - virál nepřebije všechno),
 * odběr kanálu, sledovaná hra, zájmy (kategorie a hashtagy z historie, čerstvé
 * váží víc), jazyk diváka, kvalita (jak moc lidé video dokoukávají a jak ho
 * hodnotí - videos.engagement, počítá ho denní úklid), šance pro nová videa
 * (ať nový tvůrce není neviditelný), penalizace za už zhlédnuté a za kartu,
 * kterou divák opakovaně viděl a nekliknul, a kousek náhody.
 */
export function scoreVideo(video: any, ctx: ScoreContext) {
  const now = ctx.now ?? Date.now();
  const ageDays = Math.max(0, (now - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24));
  const age = Number.isFinite(ageDays) ? ageDays : 30;
  const recencyScore = Math.exp(-age / 10) * 40;
  const views = Math.max(0, Number(video.views) || 0);
  const popularityScore = Math.log10(views + 1) * 8;

  const subscriptionBonus = video.owner_id && ctx.subscribedIds.has(video.owner_id) ? 35 : 0;

  // Zájmy: s vahou (čerstvé zhlédnutí > staré), jinak jako dřív podle top sad.
  let categoryBonus = 0;
  if (video.category) {
    const w = ctx.categoryWeights?.get(video.category);
    categoryBonus = typeof w === 'number' ? Math.round(20 * Math.max(0, Math.min(1, w))) : ctx.topCategories.has(video.category) ? 20 : 0;
  }
  const tags: string[] = Array.isArray(video.hashtags) ? video.hashtags : [];
  let hashtagBonus = 0;
  if (ctx.hashtagWeights && ctx.hashtagWeights.size > 0) {
    hashtagBonus = Math.min(18, tags.reduce((sum, h) => sum + 9 * (ctx.hashtagWeights!.get(h) ?? 0), 0));
  } else {
    hashtagBonus = Math.min(tags.filter((h) => ctx.topHashtags.has(h)).length * 6, 18);
  }

  // Hra, kterou divák sám sleduje - silnější signál než "hashtag z historie", slabší než odběr.
  const gameBonus = fromFollowedGame(video, ctx) ? 25 : 0;

  // Jazyk: video v jazyce webu diváka (čeština Čechovi, angličtina Angličanovi).
  const langBonus = languageBonus(video.language, ctx.lang);

  // Kvalita: 0-1 (dokoukanost + hodnocení), 0.5 = průměr. Bez dat nic.
  const engagement = typeof video.engagement === 'number' && Number.isFinite(video.engagement) ? Math.max(0, Math.min(1, video.engagement)) : null;
  const qualityBonus = engagement === null ? 0 : Math.round((engagement - 0.5) * 30);

  // Nové video s pár zhlédnutími: šance se ukázat (jinak by ho popularita nikdy nepustila nahoru).
  const discoveryBonus = age < 2 && views < 50 ? 10 : 0;

  const watchedPenalty = ctx.watchedIds.has(video.id) ? -50 : 0;
  const seenPenalty = ctx.impressions ? impressionPenalty(ctx.impressions(video.id)) : 0;
  const jitter = Math.random() * 10;

  return (
    recencyScore +
    popularityScore +
    subscriptionBonus +
    categoryBonus +
    hashtagBonus +
    gameBonus +
    langBonus +
    qualityBonus +
    discoveryBonus +
    watchedPenalty +
    seenPenalty +
    jitter
  );
}

/**
 * Rozmanitost: seřazení podle skóre, ale stejný kanál (a stejná kategorie)
 * za sebou postupně ztrácí body - jeden pilný kanál tak nezaplní celou
 * stránku a feed se nestane jednou kategorií. Hladový výběr, O(n²) - na
 * dávku pár desítek videí je to nic.
 */
export function diversify<T extends { owner_id?: string | null; category?: string | null }>(
  items: T[],
  score: (item: T) => number,
  opts: { sameOwner?: number; sameCategory?: number } = {}
): T[] {
  const ownerHit = opts.sameOwner ?? 14;
  const categoryHit = opts.sameCategory ?? 3;
  const pool = items.map((item) => ({ item, base: score(item) }));
  const owners = new Map<string, number>();
  const categories = new Map<string, number>();
  const out: T[] = [];
  while (pool.length > 0) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const { item, base } = pool[i];
      const o = item.owner_id ? owners.get(item.owner_id) ?? 0 : 0;
      const c = item.category ? categories.get(item.category) ?? 0 : 0;
      const value = base - o * ownerHit - c * categoryHit;
      if (value > bestScore) {
        bestScore = value;
        best = i;
      }
    }
    const [{ item }] = pool.splice(best, 1);
    out.push(item);
    if (item.owner_id) owners.set(item.owner_id, (owners.get(item.owner_id) ?? 0) + 1);
    if (item.category) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
  }
  return out;
}

/**
 * Zájmy z posledních zhlédnutí s vahou: nejčerstvější zhlédnutí váží 1,
 * starší postupně míň (polovina vahy po ~8 zhlédnutích). Výsledek je
 * normalizovaný na 0-1 (nejsilnější zájem = 1); vrací top kategorie a hashtagy.
 */
export function interestWeights(
  history: { category?: string | null; hashtags?: string[] | null }[],
  opts: { categories?: number; hashtags?: number } = {}
): { categories: Map<string, number>; hashtags: Map<string, number> } {
  const cat = new Map<string, number>();
  const tag = new Map<string, number>();
  history.forEach((h, index) => {
    const w = Math.pow(0.5, index / 8);
    if (h.category) cat.set(h.category, (cat.get(h.category) ?? 0) + w);
    for (const t of Array.isArray(h.hashtags) ? h.hashtags : []) {
      if (typeof t === 'string' && t) tag.set(t, (tag.get(t) ?? 0) + w);
    }
  });
  const top = (m: Map<string, number>, n: number) => {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const max = sorted[0]?.[1] ?? 1;
    return new Map(sorted.map(([k, v]) => [k, v / max]));
  };
  return { categories: top(cat, opts.categories ?? 4), hashtags: top(tag, opts.hashtags ?? 10) };
}

/** Sloučí kandidáty z víc zdrojů bez opakování (první výskyt vyhrává), bez už použitých. */
export function mergeCandidates<T extends { id: string }>(lists: (T[] | null | undefined)[], exclude: Set<string> = new Set()): T[] {
  const seen = new Set(exclude);
  const out: T[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * Proč se video nabízí - jedním slovem, pro popisek na kartě.
 *
 * YouTube doporučuje z černé skříňky. Kine řekne důvod: "odebíráš",
 * "podle toho, co sleduješ", "nové", "oblíbené". Vrací klíč překladu,
 * nebo null, když žádný důvod za zmínku nestojí - prázdné karty jsou
 * lepší než vymyšlený důvod.
 *
 * Bere se nejsilnější složka skóre ze scoreVideo (bez náhody a bez
 * penalizace za zhlédnuté), takže popisek říká pravdu o tom, proč je
 * video tak vysoko.
 */
export type RecommendReason = 'reasonSubscribed' | 'reasonGame' | 'reasonInterests' | 'reasonHashtags' | 'reasonNew' | 'reasonPopular';

export function explainVideo(
  video: any,
  ctx: {
    subscribedIds: Set<string>;
    topCategories: Set<string>;
    topHashtags: Set<string>;
  } & FollowedGameTags,
  now: number = Date.now()
): RecommendReason | null {
  if (video.owner_id && ctx.subscribedIds.has(video.owner_id)) return 'reasonSubscribed';
  if (fromFollowedGame(video, ctx)) return 'reasonGame';

  const category = video.category && ctx.topCategories.has(video.category) ? 20 : 0;
  const hashtagMatches = (video.hashtags ?? []).filter((h: string) => ctx.topHashtags.has(h)).length;
  const hashtags = Math.min(hashtagMatches * 6, 18);
  if (category > 0 && category >= hashtags) return 'reasonInterests';
  if (hashtags > 0) return 'reasonHashtags';

  const ageDays = (now - new Date(video.created_at).getTime()) / (1000 * 60 * 60 * 24);
  if (Number.isFinite(ageDays) && ageDays >= 0 && ageDays < 3) return 'reasonNew';

  if ((video.views ?? 0) >= 1000) return 'reasonPopular';

  return null;
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
