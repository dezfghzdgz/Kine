/**
 * Hry (lib/games.ts): katalog, poznání hry z hashtagů a názvu, výběr hry
 * při nahrávání, hra přenosu - a doporučení sledovaných her na hlavní
 * stránce (lib/homeRecommendation.ts).
 *
 * Spustit:  node tests/games.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const g = await import(join(prelozit('lib/games.ts'), 'games.js'));
const home = await import(join(prelozit('lib/homeRecommendation.ts'), 'homeRecommendation.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

/** Přesně jako appka Kine do PC (kine-desktop src/shared/clipNaming.ts - gameHashtag). */
const desktopHashtag = (game) =>
  game
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);

test('katalog: jedinečné adresy, platné pro databázi (live_streams.game), barvy, hashtagy', () => {
  const slugs = new Set();
  const tags = new Map();
  for (const game of g.GAMES) {
    assert.match(game.slug, /^[a-z0-9-]{1,40}$/, game.slug);
    assert.ok(!slugs.has(game.slug), `dvakrát ${game.slug}`);
    slugs.add(game.slug);
    assert.match(game.color, /^#[0-9a-f]{6}$/, game.slug);
    assert.ok(g.GAME_GENRES.includes(game.genre), game.slug);
    assert.equal(game.tags[0], game.tag, game.slug);
    assert.ok(game.strong.length + game.weak.length === game.tags.length, game.slug);
    for (const t of game.tags) {
      assert.equal(g.normalizeGameTag(t), t, `nenormalizovaný ${t}`);
      assert.ok(!tags.has(t), `hashtag ${t} je u ${tags.get(t)} i ${game.slug}`);
      tags.set(t, game.slug);
    }
  }
  assert.ok(g.GAMES.length >= 60);
});

// Názvy her, jak je pozná appka Kine do PC (kine-desktop src/main/gamesParse.ts - KNOWN_GAMES).
const DESKTOP = [
  ['Counter-Strike 2', 'counter-strike-2'],
  ['Counter-Strike: Global Offensive', 'counter-strike-2'],
  ['VALORANT', 'valorant'],
  ['Fortnite', 'fortnite'],
  ['Apex Legends', 'apex-legends'],
  ['Overwatch 2', 'overwatch-2'],
  ['Rainbow Six Siege', 'rainbow-six-siege'],
  ['Escape from Tarkov', 'escape-from-tarkov'],
  ['PUBG: Battlegrounds', 'pubg'],
  ['Call of Duty', 'call-of-duty'],
  ['Call of Duty: Modern Warfare', 'call-of-duty'],
  ['Call of Duty: Black Ops Cold War', 'call-of-duty'],
  ['Battlefield 2042', 'battlefield'],
  ['Battlefield 6', 'battlefield'],
  ['Battlefield V', 'battlefield'],
  ['Destiny 2', 'destiny-2'],
  ['THE FINALS', 'the-finals'],
  ['Marvel Rivals', 'marvel-rivals'],
  ['Delta Force', 'delta-force'],
  ['Halo Infinite', 'halo-infinite'],
  ['Halo: The Master Chief Collection', 'halo-infinite'],
  ['Hunt: Showdown 1896', 'hunt-showdown'],
  ['Team Fortress 2', 'team-fortress-2'],
  ['Left 4 Dead 2', 'left-4-dead-2'],
  ['Deep Rock Galactic', 'deep-rock-galactic'],
  ['HELLDIVERS 2', 'helldivers-2'],
  ["Garry's Mod", 'garrys-mod'],
  ['Deadlock', 'deadlock'],
  ['Warframe', 'warframe'],
  ['Dota 2', 'dota-2'],
  ['League of Legends', 'league-of-legends'],
  ['StarCraft II', 'starcraft-ii'],
  ['Age of Empires IV', 'age-of-empires'],
  ['Age of Empires II: Definitive Edition', 'age-of-empires'],
  ['Total War: WARHAMMER III', 'total-war'],
  ["Sid Meier's Civilization VI", 'civilization'],
  ['Hearts of Iron IV', 'hearts-of-iron-iv'],
  ['Cities: Skylines II', 'cities-skylines'],
  ['Minecraft', 'minecraft'],
  ['Roblox', 'roblox'],
  ['Rust', 'rust'],
  ['Terraria', 'terraria'],
  ['Valheim', 'valheim'],
  ['Palworld', 'palworld'],
  ['Enshrouded', 'enshrouded'],
  ['Sons of the Forest', 'sons-of-the-forest'],
  ['Subnautica', 'subnautica'],
  ['ARK: Survival Evolved', 'ark'],
  ['ARK: Survival Ascended', 'ark'],
  ['DayZ', 'dayz'],
  ['7 Days to Die', '7-days-to-die'],
  ['Project Zomboid', 'project-zomboid'],
  ['Lethal Company', 'lethal-company'],
  ['Phasmophobia', 'phasmophobia'],
  ['Dead by Daylight', 'dead-by-daylight'],
  ['Among Us', 'among-us'],
  ['Fall Guys', 'fall-guys'],
  ['Sea of Thieves', 'sea-of-thieves'],
  ['Factorio', 'factorio'],
  ['Rocket League', 'rocket-league'],
  ['Forza Horizon 5', 'forza-horizon'],
  ['Trackmania', 'trackmania'],
  ['Assetto Corsa Competizione', 'assetto-corsa'],
  ['Euro Truck Simulator 2', 'euro-truck-simulator-2'],
  ['Farming Simulator 25', 'farming-simulator'],
  ['Microsoft Flight Simulator 2024', 'microsoft-flight-simulator'],
  ['BeamNG.drive', 'beamng-drive'],
  ['War Thunder', 'war-thunder'],
  ['World of Tanks', 'world-of-tanks'],
  ['Arma 3', 'arma'],
  ['Arma Reforger', 'arma'],
  ['EA SPORTS FC 26', 'ea-sports-fc'],
  ['Grand Theft Auto V', 'gta-v'],
  ['FiveM', 'gta-v'],
  ['Red Dead Redemption 2', 'red-dead-redemption-2'],
  ['Cyberpunk 2077', 'cyberpunk-2077'],
  ['The Witcher 3: Wild Hunt', 'the-witcher-3'],
  ['Kingdom Come: Deliverance', 'kingdom-come'],
  ['ELDEN RING', 'elden-ring'],
  ['ELDEN RING NIGHTREIGN', 'elden-ring'],
  ['Black Myth: Wukong', 'black-myth-wukong'],
  ['Hogwarts Legacy', 'hogwarts-legacy'],
  ['Fallout 4', 'fallout'],
  ['The Elder Scrolls V: Skyrim', 'skyrim'],
  ["Baldur's Gate 3", 'baldurs-gate-3'],
  ['Diablo IV', 'diablo-iv'],
  ['World of Warcraft', 'world-of-warcraft'],
  ['Hearthstone', 'hearthstone'],
  ['Path of Exile', 'path-of-exile'],
  ['Genshin Impact', 'genshin-impact'],
  ['Monster Hunter Wilds', 'monster-hunter-wilds'],
  ['Monster Hunter: World', 'monster-hunter-wilds'],
  ['S.T.A.L.K.E.R. 2: Heart of Chornobyl', 'stalker-2'],
];

test('klip z appky Kine do PC (hashtag hry) patří na správnou stránku hry', () => {
  for (const [name, slug] of DESKTOP) {
    assert.equal(g.gameFromHashtags(['clip', desktopHashtag(name)], 'catGaming')?.slug ?? null, slug, name);
  }
});

test('přenos z appky pojmenovaný podle hry (výchozí název) má tu hru', () => {
  for (const [name, slug] of DESKTOP) {
    assert.equal(g.gameFromText(name)?.slug ?? null, slug, name);
  }
});

test('název přenosu: kus názvu, zkratky, nejdelší shoda; běžná slova ne', () => {
  const cases = [
    ['Hraju CS2 s klukama', 'counter-strike-2'],
    ['Minecraft survival #3', 'minecraft'],
    ['GTA RP večer', 'gta-v'],
    ['Call of Duty Warzone', 'call-of-duty'],
    ['League of Legends ranked', 'league-of-legends'],
    ['FC 25 ultimate team', 'ea-sports-fc'],
    ['Among Us s diváky', 'among-us'],
    ['Kingdom Come: Deliverance II - poprvé', 'kingdom-come'],
    ['Learning Rust today', null],
    ['Walk in the forest', null],
    ['Watching the finals tonight', null],
    ['Ukraine warzone footage', null],
    ['lol to bylo', null],
    ['Večerní stream', null],
    ['', null],
  ];
  for (const [title, slug] of cases) assert.equal(g.gameFromText(title)?.slug ?? null, slug, title);
});

test('slabé hashtagy (#rust, #mafia, #warzone) jen u videí v kategorii Hry', () => {
  assert.equal(g.gameFromHashtags(['rust', 'tutorial'], 'catEducation'), null);
  assert.equal(g.gameFromHashtags(['rust'], 'catGaming').slug, 'rust');
  assert.equal(g.gameFromHashtags(['warzone'], 'catNews'), null);
  assert.equal(g.gameFromHashtags(['callofdutywarzone'], 'catNews').slug, 'call-of-duty');
  const rust = g.gameBySlug('rust');
  assert.ok(!g.videoMatchesGame({ hashtags: ['rust'], category: 'catScience' }, rust));
  assert.ok(g.videoMatchesGame({ hashtags: ['rust'], category: 'catGaming' }, rust));
  assert.ok(g.videoMatchesGame({ hashtags: ['rustgame'], category: 'catScience' }, rust));
  // Hashtag napsaný s pomlčkou / velkými písmeny se pozná taky.
  assert.equal(g.gameFromHashtags(['Counter-Strike']).slug, 'counter-strike-2');
});

test('výběr hry při nahrávání: hlavní hashtag dopředu, bez zdvojení, nejvýš 30', () => {
  assert.deepEqual(g.withGameTag(['funny', 'clutch'], 'counter-strike-2'), ['counterstrike2', 'funny', 'clutch']);
  assert.deepEqual(g.withGameTag(['cs2', 'clutch'], 'counter-strike-2'), ['cs2', 'clutch']);
  assert.deepEqual(g.withGameTag(['a'], 'neexistuje'), ['a']);
  const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const out = g.withGameTag(many, 'minecraft');
  assert.equal(out.length, 30);
  assert.equal(out[0], 'minecraft');
});

test('změna hry u hotového videa: pryč hashtagy staré hry, nová dopředu', () => {
  assert.deepEqual(g.replaceGameTag(['minecraft', 'survival', 'minecraftjava'], 'catGaming', 'terraria'), ['terraria', 'survival']);
  assert.deepEqual(g.replaceGameTag(['cs2', 'ace'], 'catGaming', null), ['ace']);
  assert.deepEqual(g.replaceGameTag(null, 'catGaming', 'valorant'), ['valorant']);
});

test('hra přenosu: nastavená, bez migrace z názvu, neplatná nic', () => {
  assert.equal(g.liveGameSlug({ title: 'Minecraft' }), 'minecraft'); // sloupec game chybí
  assert.equal(g.liveGameSlug({ game: null, title: 'Minecraft' }), null); // streamer zvolil "bez hry"
  assert.equal(g.liveGameSlug({ game: 'valorant', title: 'cokoli' }), 'valorant');
  assert.equal(g.liveGameSlug({ game: 'evil<script>', title: 'x' }), null);
});

test('hledání hry: přesná zkratka, začátek názvu, krátký dotaz nic', () => {
  assert.deepEqual(g.searchGames('cs2').map((m) => [m.game.slug, m.score]), [['counter-strike-2', 3]]);
  assert.equal(g.searchGames('mine')[0].game.slug, 'minecraft');
  assert.equal(g.searchGames('Zaklínač').length, 0);
  assert.deepEqual(g.searchGames('x'), []);
});

test('dlaždice: iniciály a počty her z videí', () => {
  assert.equal(g.gameMonogram({ name: 'Counter-Strike 2' }), 'CS2');
  assert.equal(g.gameMonogram({ name: 'S.T.A.L.K.E.R. 2' }), 'S2');
  assert.equal(g.gameMonogram({ name: "Baldur's Gate 3" }), 'BG3');
  assert.equal(g.gameMonogram({ name: 'Minecraft' }), 'MI');
  assert.equal(g.gameMonogram({ name: 'Call of Duty' }), 'CoD');
  assert.equal(g.gameMonogram({ name: 'World of Tanks' }), 'WoT');
  assert.equal(g.gameMonogram({ name: 'Hunt: Showdown 1896' }), 'HS');
  assert.equal(g.gameMonogram({ name: 'The Witcher 3' }), 'W3');
  assert.equal(g.gameMonogram({ name: 'Cyberpunk 2077', slug: 'cyberpunk-2077' }), 'CP77');
  for (const game of g.GAMES) assert.ok(g.gameMonogram(game).length <= 4, game.slug);
  const counted = g.countGames([
    { hashtags: ['minecraft'], category: 'catGaming' },
    { hashtags: ['cs2'], category: 'catGaming' },
    { hashtags: ['minecraftjava'], category: 'catGaming' },
    { hashtags: ['rust'], category: 'catEducation' },
    { hashtags: [], category: 'catGaming' },
  ]);
  assert.deepEqual(counted.map((x) => [x.game.slug, x.count]), [['minecraft', 2], ['counter-strike-2', 1]]);
});

test('hlavní stránka: sledovaná hra zvedne video a řekne proč', () => {
  const sets = g.gameTagSets(['rust', 'minecraft', 'neexistuje']);
  assert.ok(sets.strong.has('minecraft') && sets.strong.has('rustgame') && sets.weak.has('rust'));
  const ctx = { subscribedIds: new Set(), watchedIds: new Set(), topCategories: new Set(), topHashtags: new Set(), gameStrong: sets.strong, gameWeak: sets.weak };
  const video = (o) => ({ id: 'v', owner_id: 'x', category: 'catMusic', hashtags: [], created_at: '2026-01-01T00:00:00Z', views: 0, ...o });
  assert.ok(home.fromFollowedGame(video({ hashtags: ['Minecraft'] }), ctx));
  assert.ok(!home.fromFollowedGame(video({ hashtags: ['rust'] }), ctx)); // #rust mimo Hry = programování
  assert.ok(home.fromFollowedGame(video({ hashtags: ['rust'], category: 'catGaming' }), ctx));
  assert.equal(home.explainVideo(video({ hashtags: ['minecraft'] }), ctx), 'reasonGame');
  // Odběr kanálu má přednost.
  assert.equal(home.explainVideo(video({ hashtags: ['minecraft'], owner_id: 'k' }), { ...ctx, subscribedIds: new Set(['k']) }), 'reasonSubscribed');
  // Bez sledovaných her se nic nemění (starší kontext bez polí).
  assert.equal(home.fromFollowedGame(video({ hashtags: ['minecraft'] }), {}), false);
  // Skóre: stejné video ze sledované hry je výš (náhoda je do 10, bonus 25).
  const plain = { ...ctx, gameStrong: new Set(), gameWeak: new Set() };
  const v = video({ hashtags: ['minecraft'] });
  for (let i = 0; i < 20; i++) assert.ok(home.scoreVideo(v, ctx) > home.scoreVideo(v, plain));
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
