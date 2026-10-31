/**
 * Hry na Kine - stránky her (/games, /game/[slug]), štítek hry u videa
 * a přenosu, výběr hry při nahrávání a ve studiu, sledované hry.
 *
 * Hra se pozná podle hashtagů. Appka Kine do PC dává ke klipu hashtag hry
 * (kine-desktop: gameHashtag - "Counter-Strike 2" -> "counterstrike2")
 * a lidi píšou i zkratky (#cs2). Každá hra má hlavní hashtag (přidá se,
 * když hru vybereš při nahrávání) a další, které k ní patří.
 *
 * "Slabé" hashtagy (v seznamu s vlnovkou) jsou běžná slova - #rust,
 * #mafia, #fallout, #warzone. Platí jen u videí v kategorii Hry, ať se
 * mezi klipy z Rustu nepřimíchá návod na programovací jazyk nebo zprávy
 * z války. V názvu přenosu se nehledají vůbec (jen když je hra celý název -
 * tak ho appka Kine do PC pojmenuje, když si streamer žádný nenastaví).
 *
 * Názvy her se nepřekládají (vlastní jména). Žádná loga ani obrázky her -
 * dlaždice je jen barva a název (components/GameTile.tsx).
 */

export type GameGenre = 'shooter' | 'sandbox' | 'rpg' | 'strategy' | 'coop' | 'racing' | 'mobile';

export type Game = {
  slug: string;
  name: string;
  genre: GameGenre;
  /** Barva dlaždice (#rrggbb). */
  color: string;
  /** Hlavní hashtag bez # (přidá se k videu, když hru vybereš). */
  tag: string;
  /** Všechny hashtagy hry, hlavní první. */
  tags: string[];
  /** Hashtagy, které platí u každého videa. */
  strong: string[];
  /** Hashtagy - běžná slova; platí jen v kategorii Hry. */
  weak: string[];
};

/** Kategorie videa "Hry" (lib/categories.ts). */
export const GAMING_CATEGORY = 'catGaming';

/** Pořadí žánrů na stránce /games. */
export const GAME_GENRES: GameGenre[] = ['shooter', 'sandbox', 'rpg', 'strategy', 'coop', 'racing', 'mobile'];

/** Klíč překladu pro žánr. */
export const GENRE_KEYS: Record<GameGenre, string> = {
  shooter: 'gameGenreShooter',
  sandbox: 'gameGenreSandbox',
  rpg: 'gameGenreRpg',
  strategy: 'gameGenreStrategy',
  coop: 'gameGenreCoop',
  racing: 'gameGenreRacing',
  mobile: 'gameGenreMobile',
};

/**
 * Hashtag ze jména hry nebo z toho, co napsal člověk: bez háčků, malými
 * písmeny, jen písmena a číslice, nejvýš 30 znaků - stejně jako appka
 * Kine do PC ("Counter-Strike 2" -> "counterstrike2").
 */
export function normalizeGameTag(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}

// slug, název, žánr, barva, hlavní hashtag, další hashtagy (~ = slabý).
// Pořadí uvnitř žánru = zhruba podle oblíbenosti.
type Def = [string, string, GameGenre, string, string, string?];
const DEFS: Def[] = [
  // Střílečky
  ['counter-strike-2', 'Counter-Strike 2', 'shooter', '#de9b35', 'counterstrike2', 'cs2 counterstrike csgo counterstrikeglobaloffensive'],
  ['valorant', 'VALORANT', 'shooter', '#ff4655', 'valorant'],
  ['fortnite', 'Fortnite', 'shooter', '#7c5cff', 'fortnite', 'fortnitebr fortnitebattleroyale fortnitezerobuild'],
  ['call-of-duty', 'Call of Duty', 'shooter', '#4f8a3c', 'callofduty', '~cod ~warzone callofdutywarzone codwarzone callofdutymodernwarfare callofdutymodernwarfareiii mw3 modernwarfare3 callofdutyblackops6 blackops6 bo6 callofdutyblackops7 blackops7 bo7 callofdutyblackopscoldwar'],
  ['apex-legends', 'Apex Legends', 'shooter', '#da292a', 'apexlegends', '~apex'],
  ['battlefield', 'Battlefield', 'shooter', '#ff7a1a', 'battlefield', 'battlefield6 bf6 battlefield2042 bf2042 battlefieldv bfv battlefield1 bf1 battlefield4 bf4'],
  ['overwatch-2', 'Overwatch 2', 'shooter', '#f99e1a', 'overwatch2', 'overwatch ow2'],
  ['rainbow-six-siege', 'Rainbow Six Siege', 'shooter', '#3a7bd5', 'rainbowsixsiege', 'r6s r6siege rainbowsix rainbowsixsiegex ~r6'],
  ['escape-from-tarkov', 'Escape from Tarkov', 'shooter', '#8d8460', 'escapefromtarkov', 'tarkov ~eft'],
  ['pubg', 'PUBG: Battlegrounds', 'shooter', '#f2a900', 'pubgbattlegrounds', 'pubg pubgmobile'],
  ['marvel-rivals', 'Marvel Rivals', 'shooter', '#e62429', 'marvelrivals'],
  ['arc-raiders', 'ARC Raiders', 'shooter', '#f0532d', 'arcraiders'],
  ['the-finals', 'THE FINALS', 'shooter', '#d4145a', 'thefinals'],
  ['delta-force', 'Delta Force', 'shooter', '#2f7d6d', 'deltaforce'],
  ['helldivers-2', 'HELLDIVERS 2', 'shooter', '#e3b81b', 'helldivers2', 'helldivers'],
  ['destiny-2', 'Destiny 2', 'shooter', '#6c8ebf', 'destiny2'],
  ['team-fortress-2', 'Team Fortress 2', 'shooter', '#b8383b', 'teamfortress2', 'tf2'],
  ['deadlock', 'Deadlock', 'shooter', '#8f6b4a', 'deadlock'],
  ['warframe', 'Warframe', 'shooter', '#3fb7c4', 'warframe'],
  ['halo-infinite', 'Halo Infinite', 'shooter', '#5d8a3a', 'haloinfinite', '~halo halomcc halothemasterchiefcollection'],
  ['hunt-showdown', 'Hunt: Showdown 1896', 'shooter', '#8b3a2e', 'huntshowdown1896', 'huntshowdown'],
  ['stalker-2', 'S.T.A.L.K.E.R. 2', 'shooter', '#a3a35a', 'stalker2', 'stalker2heartofchornobyl'],
  ['war-thunder', 'War Thunder', 'shooter', '#c8341d', 'warthunder'],
  ['world-of-tanks', 'World of Tanks', 'shooter', '#b5651d', 'worldoftanks'],
  ['arma', 'Arma', 'shooter', '#6b7a3a', 'arma', 'arma3 armareforger arma4'],
  // Sandbox a přežití
  ['minecraft', 'Minecraft', 'sandbox', '#5d9c3a', 'minecraft', 'minecraftjava minecraftbedrock minecraftpe mcpe'],
  ['roblox', 'Roblox', 'sandbox', '#ff3d3d', 'roblox'],
  ['rust', 'Rust', 'sandbox', '#cd412b', 'rust', 'rustgame'],
  ['terraria', 'Terraria', 'sandbox', '#2e8b57', 'terraria'],
  ['palworld', 'Palworld', 'sandbox', '#3fa6e0', 'palworld'],
  ['valheim', 'Valheim', 'sandbox', '#5a7d9a', 'valheim'],
  ['ark', 'ARK: Survival Ascended', 'sandbox', '#4a7f8c', 'arksurvivalascended', 'arksurvivalevolved arkascended'],
  ['dayz', 'DayZ', 'sandbox', '#6b6b47', 'dayz'],
  ['project-zomboid', 'Project Zomboid', 'sandbox', '#7a2e2e', 'projectzomboid', 'zomboid'],
  ['7-days-to-die', '7 Days to Die', 'sandbox', '#a33b20', '7daystodie', '7dtd'],
  ['subnautica', 'Subnautica', 'sandbox', '#1a8fb8', 'subnautica', 'subnautica2 subnauticabelowzero'],
  ['factorio', 'Factorio', 'sandbox', '#d18b2c', 'factorio'],
  ['sons-of-the-forest', 'Sons of the Forest', 'sandbox', '#3d5a3a', 'sonsoftheforest', '~theforest'],
  ['enshrouded', 'Enshrouded', 'sandbox', '#4f7aa8', 'enshrouded'],
  ['sea-of-thieves', 'Sea of Thieves', 'sandbox', '#1c9c8c', 'seaofthieves'],
  ['garrys-mod', "Garry's Mod", 'sandbox', '#1e88e5', 'garrysmod', 'gmod'],
  // RPG a akce
  ['gta-v', 'Grand Theft Auto V', 'rpg', '#57a639', 'grandtheftautov', 'gta gtav gta5 gtaonline gtarp fivem grandtheftauto'],
  ['elden-ring', 'ELDEN RING', 'rpg', '#c9a227', 'eldenring', 'eldenringnightreign nightreign'],
  ['cyberpunk-2077', 'Cyberpunk 2077', 'rpg', '#e8d60c', 'cyberpunk2077'],
  ['kingdom-come', 'Kingdom Come: Deliverance', 'rpg', '#8a6d3b', 'kingdomcomedeliverance', 'kingdomcomedeliverance2 kcd kcd2 ~kingdomcome'],
  ['mafia', 'Mafia', 'rpg', '#9b2335', 'mafia', 'mafiatheoldcountry mafiadefinitiveedition mafia2 mafiaii mafia3 mafiaiii'],
  ['red-dead-redemption-2', 'Red Dead Redemption 2', 'rpg', '#b3261e', 'reddeadredemption2', 'rdr2 reddead reddeadonline'],
  ['the-witcher-3', 'The Witcher 3', 'rpg', '#b0262a', 'thewitcher3', 'thewitcher3wildhunt witcher3 ~witcher ~thewitcher'],
  ['baldurs-gate-3', "Baldur's Gate 3", 'rpg', '#8a3ab9', 'baldursgate3', 'bg3'],
  ['genshin-impact', 'Genshin Impact', 'rpg', '#4a90c8', 'genshinimpact', 'genshin'],
  ['hollow-knight-silksong', 'Hollow Knight: Silksong', 'rpg', '#b02f3a', 'hollowknightsilksong', 'silksong hollowknight'],
  ['monster-hunter-wilds', 'Monster Hunter Wilds', 'rpg', '#3a8a5a', 'monsterhunterwilds', 'monsterhunter mhwilds monsterhunterworld mhw monsterhunterrise'],
  ['black-myth-wukong', 'Black Myth: Wukong', 'rpg', '#c47a2c', 'blackmythwukong', '~wukong'],
  ['skyrim', 'The Elder Scrolls V: Skyrim', 'rpg', '#6c7a89', 'skyrim', 'theelderscrollsvskyrim skyrimse'],
  ['fallout', 'Fallout', 'rpg', '#3f8f5f', 'fallout', 'fallout4 fallout76 fallout3 falloutnewvegas'],
  ['hogwarts-legacy', 'Hogwarts Legacy', 'rpg', '#a07a2c', 'hogwartslegacy'],
  ['world-of-warcraft', 'World of Warcraft', 'rpg', '#f0a500', 'worldofwarcraft', 'wowclassic worldofwarcraftclassic'],
  ['path-of-exile', 'Path of Exile', 'rpg', '#af6025', 'pathofexile', 'pathofexile2 poe2 ~poe'],
  ['diablo-iv', 'Diablo IV', 'rpg', '#a51e1e', 'diabloiv', 'diablo4 ~diablo'],
  // MOBA a strategie
  ['league-of-legends', 'League of Legends', 'strategy', '#c89b3c', 'leagueoflegends', 'leagueoflegend'],
  ['dota-2', 'Dota 2', 'strategy', '#b8352d', 'dota2', 'dota'],
  ['age-of-empires', 'Age of Empires', 'strategy', '#b58a4c', 'ageofempires', 'ageofempiresii ageofempires2 aoe2 aoe2de ageofempiresiidefinitiveedition ageofempiresiv ageofempires4 aoe4'],
  ['civilization', 'Civilization', 'strategy', '#3b6ea5', 'civilization', 'civ6 civ7 civilizationvi civilizationvii civilization6 civilization7 sidmeierscivilizationvi sidmeierscivilizationvii'],
  ['hearts-of-iron-iv', 'Hearts of Iron IV', 'strategy', '#6d6a4f', 'heartsofironiv', 'hoi4 heartsofiron4 heartsofiron'],
  ['total-war', 'Total War', 'strategy', '#8c1c13', 'totalwar', 'totalwarwarhammeriii totalwarwarhammer3 totalwarwarhammer warhammer3'],
  ['starcraft-ii', 'StarCraft II', 'strategy', '#2c74c9', 'starcraftii', 'starcraft2 starcraft sc2'],
  ['cities-skylines', 'Cities: Skylines', 'strategy', '#2fa5d6', 'citiesskylines', 'citiesskylinesii citiesskylines2'],
  ['hearthstone', 'Hearthstone', 'strategy', '#c9a36a', 'hearthstone'],
  // Co-op a párty
  ['among-us', 'Among Us', 'coop', '#c51111', 'amongus'],
  ['lethal-company', 'Lethal Company', 'coop', '#d35400', 'lethalcompany'],
  ['phasmophobia', 'Phasmophobia', 'coop', '#3a5a8a', 'phasmophobia', 'phasmo'],
  ['dead-by-daylight', 'Dead by Daylight', 'coop', '#9e1b1b', 'deadbydaylight', 'dbd'],
  ['fall-guys', 'Fall Guys', 'coop', '#f45ec8', 'fallguys'],
  ['deep-rock-galactic', 'Deep Rock Galactic', 'coop', '#c87f1a', 'deeprockgalactic', 'drg'],
  ['left-4-dead-2', 'Left 4 Dead 2', 'coop', '#b33a2b', 'left4dead2', 'l4d2'],
  // Závody, sport a simulátory
  ['rocket-league', 'Rocket League', 'racing', '#1f7ae0', 'rocketleague'],
  ['ea-sports-fc', 'EA SPORTS FC', 'racing', '#19b46b', 'easportsfc', 'easportsfc26 easportsfc25 easportsfc24 eafc eafc26 eafc25 fc26 fc25 fc24 fifa23 ~fifa'],
  ['forza-horizon', 'Forza Horizon', 'racing', '#e4007c', 'forzahorizon', 'forzahorizon5 forzahorizon6 fh5 fh6 ~forza'],
  ['assetto-corsa', 'Assetto Corsa', 'racing', '#c8102e', 'assettocorsa', 'assettocorsacompetizione assettocorsaevo ~acc'],
  ['trackmania', 'Trackmania', 'racing', '#1a9e4a', 'trackmania'],
  ['euro-truck-simulator-2', 'Euro Truck Simulator 2', 'racing', '#e5a50a', 'eurotrucksimulator2', 'ets2'],
  ['farming-simulator', 'Farming Simulator', 'racing', '#3c8d2f', 'farmingsimulator', 'farmingsimulator25 farmingsimulator22 fs25 fs22 landwirtschaftssimulator ls25 ls22'],
  ['microsoft-flight-simulator', 'Microsoft Flight Simulator', 'racing', '#0f6cbd', 'microsoftflightsimulator', 'microsoftflightsimulator2024 msfs msfs2024 flightsimulator'],
  ['beamng-drive', 'BeamNG.drive', 'racing', '#f08c00', 'beamngdrive', 'beamng'],
  // Mobilní hry
  ['brawl-stars', 'Brawl Stars', 'mobile', '#f5b800', 'brawlstars'],
  ['clash-royale', 'Clash Royale', 'mobile', '#2a6fdb', 'clashroyale'],
  ['clash-of-clans', 'Clash of Clans', 'mobile', '#e08a1b', 'clashofclans'],
  ['free-fire', 'Free Fire', 'mobile', '#ff7a00', 'freefire', 'garenafreefire'],
  ['mobile-legends', 'Mobile Legends: Bang Bang', 'mobile', '#3d5afe', 'mobilelegendsbangbang', 'mobilelegends mlbb'],
  ['geometry-dash', 'Geometry Dash', 'mobile', '#1fb8e0', 'geometrydash'],
];

// Hlavní hashtagy, které jsou zároveň běžné slovo (hra se jinak jmenuje jinak).
const WEAK_MAIN = new Set(['thefinals', 'deltaforce', 'deadlock', 'rust', 'enshrouded', 'mafia', 'civilization', 'totalwar', 'battlefield', 'arma', 'fallout']);

function build(def: Def): Game {
  const [slug, name, genre, color, mainRaw, rest = ''] = def;
  const tag = normalizeGameTag(mainRaw);
  const strong: string[] = [];
  const weak: string[] = [];
  (WEAK_MAIN.has(tag) ? weak : strong).push(tag);
  for (const raw of rest.split(/\s+/).filter(Boolean)) {
    const isWeak = raw.startsWith('~');
    const t = normalizeGameTag(isWeak ? raw.slice(1) : raw);
    if (!t || t === tag || strong.includes(t) || weak.includes(t)) continue;
    (isWeak ? weak : strong).push(t);
  }
  return { slug, name, genre, color, tag, tags: [tag, ...strong.filter((t) => t !== tag), ...weak.filter((t) => t !== tag)], strong, weak };
}

export const GAMES: Game[] = DEFS.map(build);

const BY_SLUG = new Map<string, Game>(GAMES.map((g) => [g.slug, g]));
const BY_TAG = new Map<string, { game: Game; weak: boolean }>();
for (const g of GAMES) {
  for (const t of g.strong) if (!BY_TAG.has(t)) BY_TAG.set(t, { game: g, weak: false });
  for (const t of g.weak) if (!BY_TAG.has(t)) BY_TAG.set(t, { game: g, weak: true });
}

/** Hra podle adresy (/game/counter-strike-2); neznámá -> null. */
export function gameBySlug(slug: unknown): Game | null {
  return typeof slug === 'string' ? BY_SLUG.get(slug) ?? null : null;
}

export function isGameSlug(slug: unknown): slug is string {
  return gameBySlug(slug) !== null;
}

/** Hra, ke které patří hashtag (slabý jen v kategorii Hry). */
export function gameFromTag(tag: unknown, category?: string | null): Game | null {
  const hit = BY_TAG.get(normalizeGameTag(tag));
  if (!hit) return null;
  if (hit.weak && category !== GAMING_CATEGORY) return null;
  return hit.game;
}

/** Hra videa podle jeho hashtagů - první, který k nějaké hře patří. */
export function gameFromHashtags(tags: unknown, category?: string | null): Game | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    const game = gameFromTag(tag, category);
    if (game) return game;
  }
  return null;
}

/** Patří video ke hře? (stejné pravidlo jako gameFromHashtags, jen pro jednu hru) */
export function videoMatchesGame(video: { hashtags?: unknown; category?: string | null }, game: Game): boolean {
  if (!Array.isArray(video.hashtags)) return false;
  const gaming = video.category === GAMING_CATEGORY;
  return video.hashtags.some((raw) => {
    const t = normalizeGameTag(raw);
    return game.strong.includes(t) || (gaming && game.weak.includes(t));
  });
}

// Krátké zkratky, které v názvu znamenají hru (jinak se bere až od 6 znaků nebo s číslicí).
const TEXT_OK = new Set(['gta', 'pubg', 'dota', 'dayz', 'gmod']);

function textSafe(tag: string): boolean {
  return tag.length >= 6 || /\d/.test(tag) || TEXT_OK.has(tag);
}

/**
 * Hra podle názvu (přenosu, videa): "Counter-Strike 2" (výchozí název
 * z appky Kine do PC), "Hraju CS2 s klukama", "Minecraft survival #3".
 * Slabé hashtagy jen když jsou celým názvem. Nejdelší shoda vyhrává
 * ("Call of Duty Warzone" -> Call of Duty, ne kus "call of").
 */
export function gameFromText(text: unknown): Game | null {
  const words = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, 40);
  if (words.length === 0) return null;
  // Celý název = hra (i slabé slovo: přenos pojmenovaný "Rust" je Rust).
  const whole = BY_TAG.get(words.join('').slice(0, 30));
  if (whole) return whole.game;
  let best: Game | null = null;
  let bestLen = 0;
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length && j < i + 6; j++) {
      joined += words[j];
      if (joined.length > 30) break;
      const hit = BY_TAG.get(joined);
      if (hit && !hit.weak && textSafe(joined) && joined.length > bestLen) {
        best = hit.game;
        bestLen = joined.length;
      }
    }
  }
  return best;
}

/**
 * Hledání hry (stránka /games, výsledky hledání). Skóre: 3 = přesně
 * název nebo hashtag ("cs2"), 2 = název začíná hledaným, 1 = obsahuje.
 */
export function searchGames(query: unknown, limit = 8): { game: Game; score: number }[] {
  const q = normalizeGameTag(query);
  if (q.length < 2) return [];
  const out: { game: Game; score: number; order: number }[] = [];
  GAMES.forEach((g, order) => {
    const name = normalizeGameTag(g.name);
    let score = 0;
    if (name === q || g.strong.includes(q)) score = 3;
    else if (name.startsWith(q) || g.strong.some((t) => t.startsWith(q) && q.length >= 3)) score = 2;
    else if (q.length >= 3 && name.includes(q)) score = 1;
    if (score > 0) out.push({ game: g, score, order });
  });
  return out
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(({ game, score }) => ({ game, score }));
}

/** Hashtagy videa s vybranou hrou: hlavní hashtag hry dopředu (když tam žádný její není), nejvýš 30. */
export function withGameTag(tags: string[], slug: unknown): string[] {
  const game = gameBySlug(slug);
  const clean = tags.filter((t) => typeof t === 'string' && t.trim());
  if (!game) return clean.slice(0, 30);
  const has = clean.some((t) => game.tags.includes(normalizeGameTag(t)));
  return (has ? clean : [game.tag, ...clean]).slice(0, 30);
}

/**
 * Změna hry u hotového videa (app/api/videos/game): pryč hashtagy
 * dosavadní hry, nové hry hlavní hashtag dopředu. Ostatní zůstávají.
 */
export function replaceGameTag(tags: unknown, category: string | null | undefined, slug: unknown): string[] {
  const list = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
  const previous = gameFromHashtags(list, category);
  const kept = previous ? list.filter((t) => !previous.tags.includes(normalizeGameTag(t))) : list;
  return withGameTag(kept, slug);
}

/**
 * Hra přenosu: co nastavil streamer (sloupec live_streams.game z migrace
 * supabase-migration-push-hry-naklady.sql). Bez té migrace (sloupec chybí)
 * se hádá z názvu.
 */
export function liveGameSlug(row: { game?: unknown; title?: unknown }): string | null {
  if (row.game === undefined) return gameFromText(row.title)?.slug ?? null;
  return isGameSlug(row.game) ? row.game : null;
}

/** Hry podle žánru (pořadí GAME_GENRES, uvnitř podle oblíbenosti). */
export function gamesByGenre(): { genre: GameGenre; games: Game[] }[] {
  return GAME_GENRES.map((genre) => ({ genre, games: GAMES.filter((g) => g.genre === genre) }));
}

/** Podobné hry (stejný žánr) na konec stránky hry. */
export function relatedGames(game: Game, limit = 8): Game[] {
  return GAMES.filter((g) => g.genre === game.genre && g.slug !== game.slug).slice(0, limit);
}

/** Všechny hashtagy sledovaných her (doporučení na hlavní stránce - lib/homeRecommendation.ts). */
export function gameTagSets(slugs: string[]): { strong: Set<string>; weak: Set<string> } {
  const strong = new Set<string>();
  const weak = new Set<string>();
  for (const slug of slugs) {
    const g = gameBySlug(slug);
    if (!g) continue;
    g.strong.forEach((t) => strong.add(t));
    g.weak.forEach((t) => weak.add(t));
  }
  return { strong, weak };
}

/**
 * Oblíbené hry z hashtagů nedávných videí (stránka /games - "Hraje se
 * teď"): kolik videí ke každé hře. Bere se jen hra videa (první shoda).
 */
export function countGames(videos: { hashtags?: unknown; category?: string | null }[]): { game: Game; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of videos) {
    const g = gameFromHashtags(v.hashtags, v.category);
    if (g) counts.set(g.slug, (counts.get(g.slug) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({ game: BY_SLUG.get(slug)!, count }))
    .sort((a, b) => b.count - a.count || GAMES.indexOf(a.game) - GAMES.indexOf(b.game));
}

/** Iniciály, které hráči sami používají (jinak se skládají z názvu). */
const MONOGRAMS: Record<string, string> = {
  'cyberpunk-2077': 'CP77',
  skyrim: 'TES',
  'overwatch-2': 'OW2',
  'rainbow-six-siege': 'R6S',
  pubg: 'PUBG',
  'gta-v': 'GTA',
  'ea-sports-fc': 'FC',
  'microsoft-flight-simulator': 'MSFS',
  'hearts-of-iron-iv': 'HoI4',
  'diablo-iv': 'D4',
  'starcraft-ii': 'SC2',
};
const SMALL_WORDS = new Set(['of', 'the', 'to', 'by', 'and', 'from', 'a', 'in', 'at']);

/**
 * Iniciály na dlaždici, nejvýš 4 znaky: "Counter-Strike 2" -> "CS2",
 * "Call of Duty" -> "CoD", "World of Warcraft" -> "WoW", "Minecraft" -> "MI".
 * Úvodní "The" a letopočty ("1896", "2077") se vynechají.
 */
export function gameMonogram(game: { name: string; slug?: string }): string {
  if (game.slug && MONOGRAMS[game.slug]) return MONOGRAMS[game.slug];
  const words = game.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’.]/g, '')
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  while (words.length > 1 && words[0].toLowerCase() === 'the') words.shift();
  const kept = words.filter((w) => !(/^\d+$/.test(w) && w.length > 2));
  if (kept.length === 0) return '?';
  if (kept.length === 1) return kept[0].slice(0, 2).toUpperCase();
  return kept
    .map((w) => (/^\d+$/.test(w) ? w : SMALL_WORDS.has(w.toLowerCase()) ? w[0].toLowerCase() : w[0].toUpperCase()))
    .join('')
    .slice(0, 4);
}
