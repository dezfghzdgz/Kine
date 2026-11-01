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
const { scoreVideo, diversify, interestWeights, mergeCandidates, languageBonus, impressionPenalty } = await import(join(kam, 'homeRecommendation.js'));
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

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
