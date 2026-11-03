/**
 * Doporučování na hlavní stránce (lib/homeRecommendation.ts): skóre,
 * rozmanitost, zájmy s vahou, slučování kandidátů a paměť zobrazení
 * (lib/feedImpressions.ts).
 * Spustit:  node tests/feedRanking.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/homeRecommendation.ts');
const hr = await import(join(kam, 'homeRecommendation.js'));
const { scoreVideo, diversify, interestWeights, mergeCandidates, languageBonus, impressionPenalty } = hr;
const kam2 = prelozit('lib/feedImpressions.ts');
const imp = await import(join(kam2, 'feedImpressions.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

// Bez náhody - skóre musí jít porovnávat.
Math.random = () => 0;

const NOW = Date.parse('2026-10-20T12:00:00Z');
const dny = (n) => new Date(NOW - n * 86400000).toISOString();
const base = { subscribedIds: new Set(), watchedIds: new Set(), topCategories: new Set(), topHashtags: new Set(), now: NOW };
const video = (o) => ({ id: 'v', owner_id: 'a', category: 'catMusic', hashtags: [], created_at: dny(5), views: 100, ...o });

test('bez nových údajů je skóre stejné jako dřív (zpětná kompatibilita)', () => {
  const v = video({});
  const s = scoreVideo(v, base);
  const expected = Math.exp(-5 / 10) * 40 + Math.log10(101) * 8;
  assert.ok(Math.abs(s - expected) < 1e-9, `${s} != ${expected}`);
});

test('kvalita: dokoukávané video nad průměrné, odklikávané pod', () => {
  const good = scoreVideo(video({ engagement: 0.9 }), base);
  const avg = scoreVideo(video({ engagement: 0.5 }), base);
  const bad = scoreVideo(video({ engagement: 0.1 }), base);
  const none = scoreVideo(video({}), base);
  assert.ok(good > avg && avg > bad);
  assert.equal(avg, none, 'průměr = bez údaje');
  assert.equal(Math.round(good - avg), 12);
});

test('kvalita mimo rozsah se ořízne (nikdo si nenapíše engagement 50)', () => {
  assert.equal(scoreVideo(video({ engagement: 50 }), base), scoreVideo(video({ engagement: 1 }), base));
  assert.equal(scoreVideo(video({ engagement: 'x' }), base), scoreVideo(video({}), base));
});

test('jazyk: shoda +10, čeština/slovenština +6, jinak nic', () => {
  assert.equal(languageBonus('cs', 'cs'), 10);
  assert.equal(languageBonus('sk', 'cs'), 6);
  assert.equal(languageBonus('cs', 'sk'), 6);
  assert.equal(languageBonus('en', 'cs'), 0);
  assert.equal(languageBonus(null, 'cs'), 0);
  assert.equal(languageBonus('cs', null), 0);
  const cz = scoreVideo(video({ language: 'cs' }), { ...base, lang: 'cs' });
  const en = scoreVideo(video({ language: 'en' }), { ...base, lang: 'cs' });
  assert.equal(Math.round(cz - en), 10);
});

test('nové video s pár zhlédnutími dostane šanci (objevování)', () => {
  const fresh = scoreVideo(video({ created_at: dny(1), views: 3 }), base);
  const freshPopular = scoreVideo(video({ created_at: dny(1), views: 3000 }), base);
  const recency = Math.exp(-1 / 10) * 40;
  assert.ok(Math.abs(fresh - (recency + Math.log10(4) * 8 + 10)) < 1e-9);
  assert.ok(freshPopular > fresh, 'popularita pořád platí');
});

test('karta viděná bez kliknutí klesá, ale nepropadne donekonečna', () => {
  assert.equal(impressionPenalty(0), 0);
  assert.equal(impressionPenalty(1), 0, 'jednou vidět nevadí');
  assert.equal(impressionPenalty(2), -9);
  assert.equal(impressionPenalty(3), -18);
  assert.equal(impressionPenalty(50), -36, 'strop');
  assert.equal(impressionPenalty(NaN), 0);
  const seen = scoreVideo(video({ id: 'x' }), { ...base, impressions: (id) => (id === 'x' ? 3 : 0) });
  assert.equal(Math.round(scoreVideo(video({ id: 'x' }), base) - seen), 18);
});

test('zájmy s vahou: čerstvé zhlédnutí váží víc', () => {
  const w = interestWeights([
    { category: 'catGaming', hashtags: ['cs2'] },
    { category: 'catMusic', hashtags: ['rap'] },
    ...Array.from({ length: 12 }, () => ({ category: 'catMusic', hashtags: [] })),
    ...Array.from({ length: 30 }, () => ({ category: 'catSport', hashtags: [] })),
  ]);
  assert.equal(w.categories.get('catMusic'), 1, 'nejsilnější = 1');
  assert.ok(w.categories.get('catGaming') > 0 && w.categories.get('catGaming') < 1);
  assert.ok(w.categories.size <= 4);
  assert.equal(w.hashtags.get('cs2'), 1, 'nejčerstvější hashtag');
  assert.ok(w.hashtags.get('rap') < 1);
});

test('zájmy s vahou se promítnou do skóre (silný zájem víc než slabý)', () => {
  const ctx = { ...base, categoryWeights: new Map([['catGaming', 1], ['catMusic', 0.25]]) };
  const g = scoreVideo(video({ category: 'catGaming' }), ctx);
  const m = scoreVideo(video({ category: 'catMusic' }), ctx);
  const o = scoreVideo(video({ category: 'catOther' }), ctx);
  assert.equal(Math.round(g - o), 20);
  assert.equal(Math.round(m - o), 5);
});

test('rozmanitost: jeden pilný kanál nezaplní začátek stránky', () => {
  const items = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: 'a' + i, owner_id: 'pilny', category: 'c1', s: 100 - i })),
    { id: 'b', owner_id: 'jiny', category: 'c2', s: 90 },
    { id: 'c', owner_id: 'treti', category: 'c3', s: 85 },
  ];
  const out = diversify(items, (v) => v.s).map((v) => v.id);
  assert.equal(out[0], 'a0', 'nejlepší pořád první');
  assert.ok(out.indexOf('b') <= 2, `b je hned nahoře: ${out}`);
  assert.ok(out.indexOf('c') <= 3, `c taky: ${out}`);
  assert.equal(out.length, items.length);
  assert.equal(new Set(out).size, items.length, 'nic se neztratí ani nezdvojí');
});

test('rozmanitost: bez opakujících se kanálů nic nemění', () => {
  const items = [{ id: 1, owner_id: 'a', s: 3 }, { id: 2, owner_id: 'b', s: 2 }, { id: 3, owner_id: 'c', s: 1 }];
  assert.deepEqual(diversify(items, (v) => v.s).map((v) => v.id), [1, 2, 3]);
  assert.deepEqual(diversify([], () => 0), []);
});

test('slučování kandidátů: bez opakování, bez už použitých, první výskyt vyhrává', () => {
  const out = mergeCandidates([[{ id: 'a', z: 1 }, { id: 'b' }], null, [{ id: 'a', z: 2 }, { id: 'c' }, { id: 'd' }]], new Set(['d']));
  assert.deepEqual(out.map((v) => v.id), ['a', 'b', 'c']);
  assert.equal(out[0].z, 1);
});

// --- podobná videa u přehrávače (lib/upNext.ts - rankRelated) ----------------

const kam3 = prelozit('lib/upNext.ts');
const { rankRelated } = await import(join(kam3, 'upNext.js'));

test('podobná videa: společné hashtagy a kategorie napřed, ne prostě nejnovější', () => {
  const current = { id: 'cur', owner_id: 'o1', category: 'catGaming', hashtags: ['Minecraft', 'survival'] };
  const list = [
    { id: 'recept', owner_id: 'x', category: 'catFood', hashtags: ['vareni'], views: 5000, created_at: dny(0) },
    { id: 'mc', owner_id: 'y', category: 'catGaming', hashtags: ['minecraft'], views: 10, created_at: dny(20) },
    { id: 'mc2', owner_id: 'z', category: 'catGaming', hashtags: ['minecraft', 'survival'], views: 10, created_at: dny(40) },
    { id: 'cur', owner_id: 'o1', category: 'catGaming', hashtags: ['minecraft'] },
    { id: 'mc', owner_id: 'y', category: 'catGaming', hashtags: ['minecraft'] },
  ];
  const out = rankRelated(list, current, new Set(), NOW).map((v) => v.id);
  assert.deepEqual(out, ['mc2', 'mc', 'recept'], 'bez aktuálního videa a bez opakování');
});

test('podobná videa: zhlédnutá až za nezhlédnutými', () => {
  const current = { id: 'cur', category: 'catGaming', hashtags: ['cs2'] };
  const list = [
    { id: 'a', category: 'catGaming', hashtags: ['cs2'], views: 100, created_at: dny(1) },
    { id: 'b', category: 'catMusic', hashtags: [], views: 1, created_at: dny(100) },
  ];
  assert.deepEqual(rankRelated(list, current, new Set(['a']), NOW).map((v) => v.id), ['b', 'a']);
  assert.deepEqual(rankRelated([], current, new Set(), NOW), []);
});

// --- paměť zobrazení ---------------------------------------------------------

test('zobrazení: stejná karta se v krátké době nepočítá dvakrát', () => {
  const m = new Map();
  assert.equal(imp.bumpImpressions(m, ['a', 'b'], NOW), true);
  assert.equal(imp.bumpImpressions(m, ['a'], NOW + 60_000), false, 'scroll nahoru a zpět');
  assert.equal(m.get('a')[0], 1);
  imp.bumpImpressions(m, ['a'], NOW + imp.IMPRESSION_GAP_MS + 1);
  assert.equal(m.get('a')[0], 2, 'další návštěva');
});

test('zobrazení: rozbitý nebo cizí obsah úložiště nic nerozbije', () => {
  assert.equal(imp.parseImpressions(null, NOW).size, 0);
  assert.equal(imp.parseImpressions('{rozbite', NOW).size, 0);
  assert.equal(imp.parseImpressions('[1,2,3]', NOW).size, 0);
  const m = imp.parseImpressions(JSON.stringify({ ok: [2, NOW - 1000], stary: [5, NOW - imp.IMPRESSIONS_TTL_MS - 1], zly: ['x', 1], nula: [0, NOW], budouc: [1, NOW + 3600_000] }), NOW);
  assert.deepEqual([...m.keys()], ['ok']);
});

test('zobrazení: úložiště drží jen pár set nejčerstvějších', () => {
  const m = new Map();
  for (let i = 0; i < 700; i++) m.set('v' + i, [1, NOW - i * 1000]);
  const p = imp.pruneImpressions(m, NOW);
  assert.equal(p.size, imp.IMPRESSIONS_MAX);
  assert.ok(p.has('v0') && !p.has('v699'));
  const back = imp.parseImpressions(imp.serializeImpressions(p), NOW);
  assert.equal(back.size, imp.IMPRESSIONS_MAX);
});

test('zobrazení: bez prohlížeče (server) nic nespadne', () => {
  imp.recordImpressions(['a']);
  imp.clearImpression('a');
  assert.equal(typeof imp.impressionsSnapshot()('a'), 'number');
});


// --- čas zveřejnění (naplánovaná videa) ---------------------------------------

test('čas zveřejnění: naplánované video stárne od vydání, ne od nahrání', () => {
  const uploaded = dny(4);
  const released = dny(0.1);
  assert.equal(hr.releaseTime({ created_at: uploaded, scheduled_at: released }, NOW), Date.parse(released));
  assert.equal(hr.releaseTime({ created_at: uploaded, scheduled_at: null }, NOW), Date.parse(uploaded));
  // Premiéra, která ještě nezačala: od nahrání (jinak by visela nahoře jako "nová" celé dny).
  const future = new Date(NOW + 3 * 86400000).toISOString();
  assert.equal(hr.releaseTime({ created_at: uploaded, scheduled_at: future }, NOW), Date.parse(uploaded));
  assert.ok(Number.isNaN(hr.releaseTime({ created_at: 'blbost' }, NOW)));
  const fresh = scoreVideo(video({ created_at: uploaded, scheduled_at: released, views: 3 }), base);
  const old = scoreVideo(video({ created_at: uploaded, views: 3 }), base);
  assert.ok(fresh - old > 20, `vydané dnes = čerstvé + šance pro nová (${fresh} vs ${old})`);
});

// --- co už divák viděl ---------------------------------------------------------

test('zhlédnuté: aspoň půlka nebo dokoukané -> 90 dní vůbec, pak jen penalizace', () => {
  const long = { duration_seconds: 600, width: 1920, height: 1080 };
  const at = (days) => NOW - days * 86400000;
  assert.deepEqual(hr.watchVerdict(undefined, long, NOW), { hide: false, penalty: 0, reason: 'none' });
  assert.equal(hr.watchVerdict({ progress: 300, completed: false, at: at(1) }, long, NOW).hide, true, 'polovina');
  assert.equal(hr.watchVerdict({ progress: 20, completed: true, at: at(1) }, long, NOW).hide, true, 'dokoukané');
  const old = hr.watchVerdict({ progress: 600, completed: true, at: at(120) }, long, NOW);
  assert.equal(old.hide, false);
  assert.equal(old.penalty, -50);
});

test('rychlý odchod (pod 10 s) = jen malá penalizace, ne pohřbení', () => {
  const long = { duration_seconds: 600, width: 1920, height: 1080 };
  const v = hr.watchVerdict({ progress: 4, completed: false, at: NOW - 3600000 }, long, NOW);
  assert.equal(v.hide, false);
  assert.equal(v.reason, 'quick');
  assert.ok(v.penalty > -10 && v.penalty < 0);
  const w = new Map([['x', { progress: 4, completed: false, at: NOW - 3600000 }]]);
  const quick = scoreVideo(video({ id: 'x', duration_seconds: 600 }), { ...base, watched: w });
  const none = scoreVideo(video({ id: 'x', duration_seconds: 600 }), base);
  assert.equal(Math.round(none - quick), 8);
});

test('rozkoukané: je v "Pokračovat ve sledování" -> ve feedu 14 dní ne; Sparks jen penalizace', () => {
  const long = { duration_seconds: 600, width: 1920, height: 1080 };
  const spark = { duration_seconds: 60, width: 1080, height: 1920 };
  const recent = { progress: 60, completed: false, at: NOW - 2 * 86400000 };
  assert.equal(hr.watchVerdict(recent, long, NOW).reason, 'resume');
  assert.equal(hr.watchVerdict(recent, long, NOW).hide, true);
  assert.equal(hr.watchVerdict({ ...recent, at: NOW - 30 * 86400000 }, long, NOW).hide, false);
  assert.equal(hr.watchVerdict({ progress: 20, completed: false, at: recent.at }, spark, NOW).hide, false, 'Spark do Pokračovat nepatří');
  assert.equal(hr.watchVerdict({ progress: 900, completed: false, at: recent.at }, { duration_seconds: null }, NOW).reason, 'resume', 'bez délky podle vteřin');
});

test('řádek historie -> WatchInfo (rozbité hodnoty nespadnou)', () => {
  assert.deepEqual(hr.watchInfoFromRow({ progress_seconds: 42, completed: true, watched_at: dny(1) }), { progress: 42, completed: true, at: NOW - 86400000 });
  assert.deepEqual(hr.watchInfoFromRow({ progress_seconds: 'x', completed: 'ano', watched_at: null }), { progress: 0, completed: false, at: 0 });
  assert.equal(hr.watchFraction({ progress: 30, completed: false, at: 0 }, 60), 0.5);
  assert.equal(hr.watchFraction({ progress: 30, completed: false, at: 0 }, 0), null);
  assert.equal(hr.watchFraction({ progress: 0, completed: true, at: 0 }, null), 1);
});

// --- náhoda se semínkem ----------------------------------------------------------

const kam4 = prelozit('lib/seededRandom.ts');
const sr = await import(join(kam4, 'seededRandom.js'));

test('náhoda se semínkem: stejné semínko = stejné skóre, jiné semínko = jiné pořadí', () => {
  const v = video({ id: 'abc' });
  const a = scoreVideo(v, { ...base, random: (id) => sr.seededUnit(1, id) });
  const b = scoreVideo(v, { ...base, random: (id) => sr.seededUnit(1, id) });
  assert.equal(a, b);
  const ids = Array.from({ length: 30 }, (_, i) => 'v' + i);
  const order = (seed) => ids.map((id) => [id, sr.seededUnit(seed, id)]).sort((x, y) => x[1] - y[1]).map((x) => x[0]).join(',');
  assert.notEqual(order(1), order(2));
  assert.equal(order(7), order(7));
});

// --- zájmy v2: dokoukanost, čas, lajky a nechuť ------------------------------------

test('zájmy: dokoukané váží víc než překlik, čerstvé víc než staré', () => {
  const w = interestWeights([
    { category: 'skip', kind: 'watch', fraction: 0.02 },
    { category: 'full', kind: 'watch', fraction: 1 },
  ], { now: NOW });
  assert.equal(w.categories.get('full'), 1);
  assert.ok(w.categories.get('skip') < 0.5, `překlik málo: ${w.categories.get('skip')}`);
  const t = interestWeights([
    { category: 'old', kind: 'watch', at: NOW - 60 * 86400000 },
    { category: 'new', kind: 'watch', at: NOW - 86400000 },
  ], { now: NOW });
  assert.equal(t.categories.get('new'), 1);
  assert.ok(t.categories.get('old') < 0.2, 'před dvěma měsíci skoro nic');
});

test('zájmy: lajk přidá, dislike a "Nezajímá mě" uberou - ale nejvýš na −0.5', () => {
  const w = interestWeights([
    { category: 'music', kind: 'watch' },
    { category: 'gaming', kind: 'watch' },
    { category: 'gaming', kind: 'like' },
    { category: 'cooking', hashtags: ['recept'], kind: 'dislike' },
    { category: 'cooking', kind: 'hide' },
    { category: 'cooking', kind: 'dislike' },
  ], { now: NOW });
  assert.equal(w.categories.get('gaming'), 1, 'lajk vytáhne nahoru');
  assert.ok(w.categories.get('music') < 1);
  assert.equal(w.categories.get('cooking'), hr.MIN_INTEREST, 'nechuť ořezaná');
  assert.ok(w.hashtags.get('recept') < 0);
  const ctx = { ...base, categoryWeights: w.categories, hashtagWeights: w.hashtags };
  const cooking = scoreVideo(video({ category: 'cooking', hashtags: ['recept'] }), ctx);
  const neutral = scoreVideo(video({ category: 'other', hashtags: [] }), ctx);
  assert.ok(neutral - cooking >= 10 && neutral - cooking <= 19, `nechuť je znát, ale omezeně: ${neutral - cooking}`);
  assert.deepEqual(hr.topInterests(w.categories, 3), ['gaming', 'music'], 'top zájmy jen kladné');
});

// --- celá zásoba místo jedné dávky --------------------------------------------------

test('rozmanitost napříč dávkami: kanál z minulé dávky další nezačne', () => {
  const items = [
    { id: 'a1', owner_id: 'pilny', category: 'c', s: 100 },
    { id: 'b1', owner_id: 'jiny', category: 'c', s: 95 },
  ];
  assert.deepEqual(diversify(items, (v) => v.s).map((v) => v.id), ['a1', 'b1']);
  const prior = hr.nextDiversityPrior(null, [{ owner_id: 'pilny', category: 'x' }]);
  assert.deepEqual(diversify(items, (v) => v.s, { prior }).map((v) => v.id), ['b1', 'a1']);
  const decayed = hr.nextDiversityPrior(prior, []);
  assert.equal(decayed.owners.get('pilny'), 0.5, 'starší dávky váží míň');
});

test('dávka: dlouhá videa i Sparks podle kvóty, chybějící druh se doplní druhým', () => {
  const long = (id) => ({ id, short: false });
  const short = (id) => ({ id, short: true });
  const ranked = [short('s1'), long('l1'), short('s2'), short('s3'), long('l2'), long('l3')];
  const { chunk, rest } = hr.pickChunk(ranked, (v) => v.short, { long: 2, short: 1, total: 3 });
  assert.deepEqual(chunk.map((v) => v.id), ['s1', 'l1', 'l2']);
  assert.deepEqual(rest.map((v) => v.id), ['s2', 's3', 'l3']);
  const onlyShort = hr.pickChunk([short('a'), short('b'), short('c')], (v) => v.short, { long: 2, short: 1, total: 3 });
  assert.deepEqual(onlyShort.chunk.map((v) => v.id), ['a', 'b', 'c'], 'dlouhá nejsou - doplní se Sparks');
  assert.deepEqual(hr.pickChunk([], (v) => v.short, { long: 2, short: 1, total: 3 }), { chunk: [], rest: [] });
});

test('zásoba: zhlédnuté video nahoru nepustí, místo něj něco jiného (dřív jen přeřazení v dávce)', () => {
  const at = NOW - 86400000;
  const watched = new Map([['seen', { progress: 600, completed: true, at }]]);
  const pool = [
    { id: 'seen', owner_id: 'a', category: 'c', created_at: dny(0.2), views: 5000, duration_seconds: 600, width: 1920, height: 1080 },
    { id: 'fresh', owner_id: 'b', category: 'c', created_at: dny(3), views: 10, duration_seconds: 600, width: 1920, height: 1080 },
  ];
  const admitted = pool.filter((v) => !hr.watchVerdict(watched.get(v.id), v, NOW).hide);
  assert.deepEqual(admitted.map((v) => v.id), ['fresh']);
});

// --- měřák přehrávání (zápis do historie až po ~3 s) -----------------------------------

const kam5 = prelozit('lib/playbackMeter.ts');
const pm = await import(join(kam5, 'playbackMeter.js'));

test('měřák: počítá jen opravdové přehrávání (ne pauzu ani přeskočení)', () => {
  let m = pm.EMPTY_METER;
  m = pm.meterStep(m, { time: 0, playing: true, duration: 100 });
  m = pm.meterStep(m, { time: 1, playing: true, duration: 100 });
  m = pm.meterStep(m, { time: 1, playing: false, duration: 100 });
  m = pm.meterStep(m, { time: 60, playing: true, duration: 100 });
  assert.equal(m.played, 1, 'pauza a skok na 60 s se nepočítají');
  m = pm.meterStep(m, { time: 61, playing: true, duration: 100 });
  m = pm.meterStep(m, { time: 62.5, playing: true, duration: 100 });
  assert.equal(m.played, 3.5);
  assert.ok(m.played >= pm.REAL_PLAYBACK_S);
  assert.equal(pm.meterProgress(m, 100).completed, false);
});

test('měřák: smyčka (Sparks) se počítá a znamená dokoukáno', () => {
  let m = pm.EMPTY_METER;
  for (const t of [0, 1, 2, 2.9, 0.8]) m = pm.meterStep(m, { time: t, playing: true, duration: 3 });
  assert.equal(m.loops, 1);
  assert.ok(m.played > 3);
  assert.deepEqual(pm.meterProgress(m, 3), { progress: 3, completed: true });
});

test('měřák: přehrávač bez pozice (NaN), ale hraje -> počítá po krocích; nesmysl nespadne', () => {
  let m = pm.EMPTY_METER;
  for (let i = 0; i < 3; i++) m = pm.meterStep(m, { time: NaN, playing: true });
  assert.equal(m.played, 3);
  assert.equal(pm.meterStep(pm.EMPTY_METER, { time: NaN, playing: false }).played, 0);
  assert.deepEqual(pm.meterProgress(pm.EMPTY_METER, null), { progress: 0, completed: false });
});

// --- pořadí Sparks ----------------------------------------------------------------------

const kam6 = prelozit('lib/sparksRanking.ts');
const sp = await import(join(kam6, 'sparksRanking.js'));

const spark = (o) => ({ id: 's', owner_id: 'x', width: 1080, height: 1920, duration_seconds: 30, created_at: dny(1), views: 10, ...o });

test('Sparks: vlastní, schované, premiéra a dlouhá videa do řady nepatří', () => {
  const ctx = { viewerId: 'me', hidden: { videoIds: new Set(['h']), channelIds: new Set(['blocked']) }, random: () => 0, now: NOW };
  const list = [
    spark({ id: 'ok' }),
    spark({ id: 'mine', owner_id: 'me' }),
    spark({ id: 'h' }),
    spark({ id: 'ch', owner_id: 'blocked' }),
    spark({ id: 'soon', scheduled_at: new Date(NOW + 86400000).toISOString(), is_premiere: true }),
    spark({ id: 'land', width: 1920, height: 1080 }),
    spark({ id: 'long', duration_seconds: 600 }),
  ];
  assert.deepEqual(sp.rankSparks(list, ctx).map((v) => v.id), ['ok']);
});

test('Sparks: zhlédnuté a přeskočené dozadu, jinak čerstvé napřed - a pokaždé stejně se stejným semínkem', () => {
  const list = [
    spark({ id: 'seen', created_at: dny(0.1), owner_id: 'a' }),
    spark({ id: 'skipped', created_at: dny(0.2), owner_id: 'b' }),
    spark({ id: 'older', created_at: dny(3), owner_id: 'c' }),
    spark({ id: 'acc', created_at: dny(0.3), owner_id: 'd' }),
  ];
  const ctx = {
    seenLocal: new Set(['seen']),
    impressions: (id) => (id === 'skipped' ? 4 : 0),
    watched: new Map([['acc', { progress: 30, completed: true, at: NOW - 3600000 }]]),
    random: () => 0.5,
    now: NOW,
  };
  const ids = sp.rankSparks(list, ctx).map((v) => v.id);
  assert.equal(ids[0], 'older', `nezhlédnuté napřed: ${ids}`);
  assert.equal(ids[1], 'skipped');
  assert.deepEqual(sp.rankSparks(list, ctx).map((v) => v.id), ids, 'stejný vstup = stejné pořadí');
});

test('Sparks: jeden kanál nejede několikrát za sebou', () => {
  const list = [
    spark({ id: 'a1', owner_id: 'a', views: 1000 }),
    spark({ id: 'a2', owner_id: 'a', views: 1000 }),
    spark({ id: 'a3', owner_id: 'a', views: 1000 }),
    spark({ id: 'b1', owner_id: 'b', views: 100 }),
  ];
  const ids = sp.rankSparks(list, { random: () => 0, now: NOW }).map((v) => v.id);
  assert.equal(ids[1], 'b1', `druhý jiný kanál: ${ids}`);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
