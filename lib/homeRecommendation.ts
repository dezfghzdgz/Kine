import { isSpark } from './videoBlocks';

export type Block = { type: 'long' | 'sparks'; items: any[] };

/**
 * Kolik videí si hlavní stránka řekne z databáze najednou (jedna stránka
 * časové osy). Videa se berou po dávkách přímo z databáze, takže strop
 * není žádný a prohlížeč nemusí naráz zpracovat celý balík.
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

export const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDuration(seconds: number | null) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Čas v ms z textu (ISO), čísla nebo Date; jinak NaN. */
function toMs(value: unknown): number {
  if (typeof value === 'string') return Date.parse(value);
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return NaN;
}

/**
 * Kdy video doopravdy vyšlo: naplánované video vychází až v čase
 * zveřejnění, ne v čase nahrání. Dřív se stáří počítalo od nahrání -
 * video nahrané v pondělí a zveřejněné v pátek bylo v pátek "čtyři dny
 * staré" a čerstvost i šance pro nová videa ho minuly.
 *
 * Premiéra, která ještě nezačala, se počítá od nahrání (odpočet se
 * ukazuje dopředu, ale jako "nové" by visela nahoře celé dny).
 * Vrací ms, nebo NaN, když datum chybí.
 */
export function releaseTime(video: { created_at?: unknown; scheduled_at?: unknown } | null | undefined, now: number = Date.now()): number {
  const created = toMs(video?.created_at);
  const scheduled = toMs(video?.scheduled_at);
  if (Number.isFinite(scheduled) && scheduled <= now && (!Number.isFinite(created) || scheduled > created)) return scheduled;
  return created;
}

// --- Co už divák viděl -----------------------------------------------------

/** Řádek historie: kam se divák dostal (s), jestli dokoukal, kdy (ms). */
export type WatchInfo = { progress: number; completed: boolean; at: number };

/** Od tolika (podílu délky) se video bere jako zhlédnuté. */
export const WATCHED_FRACTION = 0.5;
/** Zhlédnuté video se na hlavní stránku tak dlouho nevrací. */
export const WATCHED_HIDE_DAYS = 90;
/** Rozkoukané video je tak dlouho v řadě "Pokračovat ve sledování" - ve feedu ho podruhé netřeba. */
export const RESUME_HIDE_DAYS = 14;
/** Pod tolik vteřin to byl jen rychlý odchod (překlik) - jen malá penalizace. */
export const QUICK_EXIT_SECONDS = 10;

/** Řádek historie z databáze (watch_history) -> WatchInfo. */
export function watchInfoFromRow(row: { progress_seconds?: unknown; completed?: unknown; watched_at?: unknown } | null | undefined): WatchInfo {
  const progress = Number(row?.progress_seconds);
  const at = toMs(row?.watched_at);
  return {
    progress: Number.isFinite(progress) && progress > 0 ? progress : 0,
    completed: row?.completed === true,
    at: Number.isFinite(at) ? at : 0,
  };
}

/** Kolik videa divák viděl (0-1); null = nejde říct (chybí délka). */
export function watchFraction(info: WatchInfo | null | undefined, durationSeconds: unknown): number | null {
  if (!info) return null;
  if (info.completed) return 1;
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, Math.min(1, info.progress / duration));
}

export type WatchVerdict = {
  /** Na hlavní stránku teď vůbec nepatří. */
  hide: boolean;
  /** Body ke skóre (záporné). */
  penalty: number;
  reason: 'none' | 'watched' | 'resume' | 'partial' | 'quick';
};

/**
 * Co s videem, které divák už otevřel. Dřív platilo "otevřel = viděl":
 * dvouvteřinový překlik video pohřbil (−50) stejně jako dokoukání. Teď:
 *  - zhlédnuté (aspoň půlka nebo dokoukané): 90 dní vůbec, pak −50,
 *  - rozkoukané (aspoň 10 s): je v "Pokračovat ve sledování", ve feedu
 *    14 dní ne, pak −30 (u Sparks se rozkoukané nenabízí, takže jen −30),
 *  - rychlý odchod (pod 10 s): jen −8 - mohl to být překlik.
 */
export function watchVerdict(
  info: WatchInfo | null | undefined,
  video: { duration_seconds?: unknown; width?: unknown; height?: unknown } | null | undefined,
  now: number = Date.now()
): WatchVerdict {
  if (!info) return { hide: false, penalty: 0, reason: 'none' };
  const fraction = watchFraction(info, video?.duration_seconds);
  // Neznámý čas = bereme jako nedávno (radši neukázat zhlédnuté).
  const days = info.at > 0 ? Math.max(0, (now - info.at) / DAY_MS) : 0;
  if (info.completed || (fraction !== null && fraction >= WATCHED_FRACTION)) {
    return days < WATCHED_HIDE_DAYS ? { hide: true, penalty: -80, reason: 'watched' } : { hide: false, penalty: -50, reason: 'watched' };
  }
  if (!(info.progress >= QUICK_EXIT_SECONDS)) return { hide: false, penalty: -8, reason: 'quick' };
  const short = !!video && isSpark(video);
  if (!short && days < RESUME_HIDE_DAYS) return { hide: true, penalty: -30, reason: 'resume' };
  return { hide: false, penalty: -30, reason: 'partial' };
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
    const h = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    return !!ctx.gameStrong?.has(h) || (gaming && !!ctx.gameWeak?.has(h));
  });
}

/**
 * Co o divákovi víme navíc (vše nepovinné - bez toho skóre funguje jako dřív).
 *  - lang: jazyk webu (videa v jeho jazyce dostanou přednost),
 *  - categoryWeights / hashtagWeights: zájmy s vahou -0.5 až 1 (čerstvá a dokoukaná
 *    zhlédnutí a lajky víc, disliky a "Nezajímá mě" do minusu),
 *  - impressions: kolikrát už divák kartu viděl na hlavní stránce a nekliknul (lib/feedImpressions.ts),
 *  - watched: historie s rozkoukaností (watchVerdict) - přesnější než watchedIds,
 *  - random: náhoda 0-1 pro video, stálá ~30 minut (lib/seededRandom.ts); bez ní Math.random,
 *  - now: pevný čas (testy).
 */
export type ScoreExtras = {
  lang?: string | null;
  categoryWeights?: Map<string, number>;
  hashtagWeights?: Map<string, number>;
  impressions?: (videoId: string) => number;
  watched?: Map<string, WatchInfo>;
  random?: (videoId: string) => number;
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

/** Nejnižší váha zájmu (dislike, "Nezajímá mě") - ať jedna nechuť nepohřbí celou kategorii. */
export const MIN_INTEREST = -0.5;

/**
 * Skóre videa pro hlavní stránku - podle něj se řadí (ne čistě podle data).
 *
 * Složky: čerstvost (od zveřejnění), popularita (logaritmicky - virál
 * nepřebije všechno), odběr kanálu, sledovaná hra, zájmy (kategorie
 * a hashtagy z historie, lajků a disliků), jazyk diváka, kvalita (jak moc
 * lidé video dokoukávají a jak ho hodnotí - videos.engagement, počítá ho
 * denní úklid), šance pro nová videa (ať nový tvůrce není neviditelný),
 * penalizace za už viděné (podle toho, kolik z něj divák viděl) a za
 * kartu, kterou divák opakovaně viděl a nekliknul, a kousek náhody.
 */
export function scoreVideo(video: any, ctx: ScoreContext) {
  const now = ctx.now ?? Date.now();
  const ageDays = Math.max(0, (now - releaseTime(video, now)) / DAY_MS);
  const age = Number.isFinite(ageDays) ? ageDays : 30;
  const recencyScore = Math.exp(-age / 10) * 40;
  const views = Math.max(0, Number(video.views) || 0);
  const popularityScore = Math.log10(views + 1) * 8;

  const subscriptionBonus = video.owner_id && ctx.subscribedIds.has(video.owner_id) ? 35 : 0;

  // Zájmy: s vahou (čerstvé a dokoukané > staré, nechuť do minusu), jinak jako dřív podle top sad.
  let categoryBonus = 0;
  if (video.category) {
    const w = ctx.categoryWeights?.get(video.category);
    categoryBonus = typeof w === 'number' && Number.isFinite(w)
      ? Math.round(20 * Math.max(MIN_INTEREST, Math.min(1, w)))
      : ctx.topCategories.has(video.category) ? 20 : 0;
  }
  const tags: string[] = Array.isArray(video.hashtags) ? video.hashtags : [];
  let hashtagBonus = 0;
  if (ctx.hashtagWeights && ctx.hashtagWeights.size > 0) {
    const sum = tags.reduce((acc, h) => {
      const w = ctx.hashtagWeights!.get(h);
      return acc + (typeof w === 'number' && Number.isFinite(w) ? 9 * w : 0);
    }, 0);
    hashtagBonus = Math.max(-9, Math.min(18, sum));
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

  // Už viděné: podle toho, kolik z něj divák viděl (watchVerdict); bez historie s rozkoukaností jako dřív.
  const watchedPenalty = ctx.watched
    ? watchVerdict(ctx.watched.get(video.id), video, now).penalty
    : ctx.watchedIds.has(video.id) ? -50 : 0;
  const seenPenalty = ctx.impressions ? impressionPenalty(ctx.impressions(video.id)) : 0;
  const unit = ctx.random ? Number(ctx.random(String(video.id))) : Math.random();
  const jitter = (Number.isFinite(unit) ? Math.max(0, Math.min(1, unit)) : 0) * 10;

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

/** Kolikrát už se kanál a kategorie objevily (pro rozmanitost napříč dávkami). */
export type DiversityPrior = {
  owners?: ReadonlyMap<string, number>;
  categories?: ReadonlyMap<string, number>;
};

/**
 * Rozmanitost: seřazení podle skóre, ale stejný kanál (a stejná kategorie)
 * za sebou postupně ztrácí body - jeden pilný kanál tak nezaplní celou
 * stránku a feed se nestane jednou kategorií. Hladový výběr, O(n²) - na
 * pár set kandidátů je to nic. `prior` = co už je na stránce (s útlumem,
 * viz nextDiversityPrior), ať další dávka nezačne tím samým kanálem.
 */
export function diversify<T extends { owner_id?: string | null; category?: string | null }>(
  items: T[],
  score: (item: T) => number,
  opts: { sameOwner?: number; sameCategory?: number; prior?: DiversityPrior } = {}
): T[] {
  const ownerHit = opts.sameOwner ?? 14;
  const categoryHit = opts.sameCategory ?? 3;
  const pool = items.map((item) => ({ item, base: score(item) }));
  const owners = new Map<string, number>(opts.prior?.owners ?? []);
  const categories = new Map<string, number>(opts.prior?.categories ?? []);
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

/** Rozmanitost pro další dávku: dosavadní počty napůl (útlum) + to, co právě přibylo. */
export function nextDiversityPrior(prior: DiversityPrior | null | undefined, added: readonly { owner_id?: string | null; category?: string | null }[], decay = 0.5): { owners: Map<string, number>; categories: Map<string, number> } {
  const owners = new Map<string, number>();
  const categories = new Map<string, number>();
  for (const [k, v] of prior?.owners ?? []) if (v * decay >= 0.05) owners.set(k, v * decay);
  for (const [k, v] of prior?.categories ?? []) if (v * decay >= 0.05) categories.set(k, v * decay);
  for (const item of added) {
    if (item.owner_id) owners.set(item.owner_id, (owners.get(item.owner_id) ?? 0) + 1);
    if (item.category) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
  }
  return { owners, categories };
}

/**
 * Další dávka karet z už seřazených kandidátů: nejvýš `long` dlouhých
 * a `short` Sparks (ať má pruh Sparks co ukázat a dlouhá videa nezmizí),
 * dohromady `total`. Když jeden druh dojde, doplní se druhým. Pořadí
 * zůstává; vrací dávku a zbytek.
 */
export function pickChunk<T>(
  ranked: readonly T[],
  isShort: (item: T) => boolean,
  quota: { long: number; short: number; total: number }
): { chunk: T[]; rest: T[] } {
  const chunk: T[] = [];
  let rest: T[] = [];
  let longs = 0;
  let shorts = 0;
  for (const item of ranked) {
    if (chunk.length >= quota.total) {
      rest.push(item);
      continue;
    }
    const short = isShort(item);
    if (short ? shorts < quota.short : longs < quota.long) {
      chunk.push(item);
      if (short) shorts++;
      else longs++;
    } else {
      rest.push(item);
    }
  }
  if (chunk.length < quota.total && rest.length > 0) {
    const room = quota.total - chunk.length;
    const fill = rest.slice(0, room);
    chunk.push(...fill);
    rest = rest.slice(fill.length);
  }
  return { chunk, rest };
}

/** Jeden signál o zájmu diváka. */
export type InterestSignal = {
  category?: string | null;
  hashtags?: string[] | null;
  /** Zhlédnutí (výchozí), lajk, dislike, nebo "Nezajímá mě". */
  kind?: 'watch' | 'like' | 'dislike' | 'hide';
  /** Kdy (ms) - čerstvější váží víc. Bez údaje bez útlumu v čase. */
  at?: number | null;
  /** Kolik videa divák viděl (0-1); bez údaje plná váha. */
  fraction?: number | null;
};

/** Za kolik dní zájem ztratí ~63 % váhy (e^-1). */
const INTEREST_DECAY_DAYS = 21;

/**
 * Zájmy z posledních signálů s vahou. Zhlédnutí: nejčerstvější váží 1,
 * starší míň (polovina po ~8 zhlédnutích) a ještě míň, čím je dávnější
 * (útlum po dnech) a čím méně z videa divák viděl (překlik skoro nic,
 * dokoukané plně). Lajk váží 1.5×, dislike a "Nezajímá mě" jdou do minusu.
 * Výsledek je normalizovaný (nejsilnější zájem = 1, nechuť nejvýš −0.5);
 * vrací top kategorie a hashtagy (a pár nejzápornějších).
 */
export function interestWeights(
  history: InterestSignal[],
  opts: { categories?: number; hashtags?: number; negatives?: number; now?: number } = {}
): { categories: Map<string, number>; hashtags: Map<string, number> } {
  const now = opts.now ?? Date.now();
  const cat = new Map<string, number>();
  const tag = new Map<string, number>();
  let watchIndex = 0;
  for (const h of history) {
    if (!h) continue;
    const kind = h.kind ?? 'watch';
    const at = typeof h.at === 'number' && Number.isFinite(h.at) && h.at > 0 ? h.at : null;
    const decay = at === null ? 1 : Math.exp(-Math.max(0, now - at) / (INTEREST_DECAY_DAYS * DAY_MS));
    let w: number;
    if (kind === 'watch') {
      const fraction = typeof h.fraction === 'number' && Number.isFinite(h.fraction) ? Math.max(0, Math.min(1, h.fraction)) : null;
      w = Math.pow(0.5, watchIndex / 8) * decay * (fraction === null ? 1 : 0.3 + 0.7 * fraction);
      watchIndex++;
    } else if (kind === 'like') {
      w = 1.5 * decay;
    } else {
      w = -1 * decay;
    }
    if (!Number.isFinite(w) || w === 0) continue;
    if (h.category) cat.set(h.category, (cat.get(h.category) ?? 0) + w);
    for (const t of Array.isArray(h.hashtags) ? h.hashtags : []) {
      if (typeof t === 'string' && t) tag.set(t, (tag.get(t) ?? 0) + w);
    }
  }
  const shape = (m: Map<string, number>, n: number, negatives: number) => {
    const positive = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
    const max = positive[0]?.[1] ?? 0;
    const scale = max > 0 ? max : 1;
    const negative = [...m.entries()].filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, negatives);
    return new Map<string, number>([
      ...positive.map(([k, v]) => [k, v / scale] as [string, number]),
      ...negative.map(([k, v]) => [k, Math.max(MIN_INTEREST, v / scale)] as [string, number]),
    ]);
  };
  return {
    categories: shape(cat, opts.categories ?? 4, opts.negatives ?? 3),
    hashtags: shape(tag, opts.hashtags ?? 10, opts.negatives ?? 5),
  };
}

/** Klíče s kladnou vahou, od nejsilnějšího (top zájmy pro popisky a dotazy). */
export function topInterests(weights: Map<string, number>, n: number): string[] {
  return [...weights.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
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

  const ageDays = (now - releaseTime(video, now)) / DAY_MS;
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
