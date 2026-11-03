/**
 * Test doporučení po konci videa (lib/upNext.ts): jen nezhlédnutá videa,
 * příbuzná napřed, a paměť zhlédnutých v prohlížeči.
 *
 * Spustit:  node tests/upNext.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/upNext.ts');
const u = await import(join(kam, 'upNext.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const current = { id: 'now', owner_id: 'alice', category: 'catGaming' };
const list = [
  { id: 'a', owner_id: 'bob', category: 'catMusic' },
  { id: 'b', owner_id: 'carl', category: 'catGaming' },
  { id: 'c', owner_id: 'alice', category: 'catGaming' },
  { id: 'd', owner_id: 'alice', category: 'catFilm' },
  { id: 'now', owner_id: 'alice', category: 'catGaming' },
  { id: 'e', owner_id: 'dave', category: 'catSport' },
];

test('po konci jen nezhlédnutá videa (ani to, které právě skončilo)', () => {
  const seen = new Set(['b', 'e']);
  const ids = u.rankUpNext(list, current, seen).map((v) => v.id);
  assert.ok(!ids.includes('b') && !ids.includes('e') && !ids.includes('now'));
  assert.equal(ids.length, 3);
});

test('příbuzná napřed: stejná kategorie i tvůrce > kategorie > tvůrce > zbytek (jinak od nejnovějšího)', () => {
  assert.deepEqual(u.rankUpNext(list, current, new Set()).map((v) => v.id), ['c', 'b', 'd', 'a', 'e']);
});

test('všechno zhlédnuté = nic se nenabídne (žádné opakování starých)', () => {
  assert.deepEqual(u.rankUpNext(list, current, new Set(['a', 'b', 'c', 'd', 'e'])), []);
});

test('po konci: málo nových -> doplní nejdéle neviděná (nabídka nikdy prázdná)', () => {
  // Zhlédnutá od nejnovějšího: e (právě), a, d, b, c (nejdávněji).
  const order = ['e', 'a', 'd', 'b', 'c'];
  assert.deepEqual(u.upNextWithFallback(list, current, order).map((v) => v.id), ['c', 'b', 'd', 'a', 'e'], 'všechno viděné: nejdávněji viděné napřed');
  assert.deepEqual(u.upNextWithFallback(list, current, ['a', 'b', 'c', 'd']).slice(0, 2).map((v) => v.id), ['e', 'd'], 'jedno nové + nejdávněji viděné');
  // Kandidáti přichází už seřazení podle podobnosti (rankRelated) - pořadí se drží, jen bez zhlédnutých.
  assert.deepEqual(u.upNextWithFallback(list, current, ['a']).map((v) => v.id), ['b', 'c', 'd', 'e'], 'nových dost - zhlédnutá se nepřidávají');
  assert.ok(!u.upNextWithFallback(list, current, order).some((v) => v.id === 'now'), 'nikdy to samé video');
});

test('seznam vedle videa: nezhlédnutá napřed, zhlédnutá za nimi', () => {
  assert.deepEqual(u.unseenFirst(list.filter((v) => v.id !== 'now'), new Set(['a', 'c'])).map((v) => v.id), ['b', 'd', 'e', 'a', 'c']);
});

test('paměť zhlédnutých: nejnovější napřed, bez opakování, se stropem', () => {
  assert.deepEqual(u.addSeen(['x', 'y'], 'y'), ['y', 'x']);
  assert.deepEqual(u.addSeen([], 'z'), ['z']);
  assert.equal(u.addSeen(Array.from({ length: 600 }, (_, i) => `v${i}`), 'new').length, u.SEEN_MAX);
  assert.deepEqual(u.addSeen(['a'], ''), ['a']);
});


test('po konci se drží pořadí podle podobnosti (shoda v hashtazích se neztratí)', () => {
  const NOW = Date.parse('2026-11-03T12:00:00Z');
  const cur = { id: 'cur', owner_id: 'o1', category: 'catGaming', hashtags: ['minecraft', 'survival'] };
  const cands = [
    // stejná kategorie i tvůrce, ale žádný společný hashtag
    { id: 'same', owner_id: 'o1', category: 'catGaming', hashtags: [], views: 10, created_at: new Date(NOW - 86400000).toISOString() },
    // jiná kategorie, ale oba hashtagy
    { id: 'tags', owner_id: 'x', category: 'catFilm', hashtags: ['minecraft', 'survival'], views: 10, created_at: new Date(NOW - 86400000).toISOString() },
  ];
  const ranked = u.rankRelated(cands, cur, new Set(), NOW);
  assert.deepEqual(ranked.map((v) => v.id), ['tags', 'same'], 'dva společné hashtagy (24) > kategorie + tvůrce (18)');
  assert.deepEqual(u.upNextWithFallback(ranked, cur, [], 2, NOW).map((v) => v.id), ['tags', 'same'], 'po konci stejné pořadí jako vedle videa');
});

test('po konci nikdy video, které ještě nejde pustit (premiéra s odpočtem, naplánované)', () => {
  const NOW = Date.parse('2026-11-03T12:00:00Z');
  const later = new Date(NOW + 3 * 86400000).toISOString();
  const earlier = new Date(NOW - 3600000).toISOString();
  const cands = [
    { id: 'premiere', owner_id: 'alice', category: 'catGaming', scheduled_at: later, is_premiere: true },
    { id: 'scheduled', owner_id: 'alice', category: 'catGaming', scheduled_at: later, is_premiere: false },
    { id: 'started', owner_id: 'alice', category: 'catGaming', scheduled_at: earlier, is_premiere: true },
    { id: 'plain', owner_id: 'bob', category: 'catMusic' },
  ];
  const ids = u.upNextWithFallback(cands, current, [], 2, NOW).map((v) => v.id);
  assert.deepEqual(ids, ['started', 'plain']);
  assert.deepEqual(u.upNextWithFallback(cands, current, ['started', 'plain'], 2, NOW).map((v) => v.id), ['plain', 'started'], 'ani jako doplnění ze zhlédnutých');
  assert.equal(u.notPlayableYet({ scheduled_at: later }, NOW), true);
  assert.equal(u.notPlayableYet({ scheduled_at: earlier }, NOW), false);
  assert.equal(u.notPlayableYet({ scheduled_at: null }, NOW), false);
  assert.equal(u.notPlayableYet({ scheduled_at: 'blbost' }, NOW), false);
});

test('seznam vedle videa: jeden kanál nezaplní začátek (lehká rozmanitost)', () => {
  const NOW = Date.parse('2026-11-03T12:00:00Z');
  const cur = { id: 'cur', owner_id: 'o1', category: 'catGaming', hashtags: ['cs2'] };
  const day = (n) => new Date(NOW - n * 86400000).toISOString();
  const cands = [
    { id: 'o1a', owner_id: 'o1', category: 'catGaming', hashtags: ['cs2'], views: 100, created_at: day(1) },
    { id: 'o1b', owner_id: 'o1', category: 'catGaming', hashtags: ['cs2'], views: 100, created_at: day(2) },
    { id: 'o1c', owner_id: 'o1', category: 'catGaming', hashtags: ['cs2'], views: 100, created_at: day(3) },
    { id: 'other', owner_id: 'o2', category: 'catGaming', hashtags: ['cs2'], views: 100, created_at: day(4) },
  ];
  const ids = u.rankRelated(cands, cur, new Set(), NOW).map((v) => v.id);
  assert.equal(ids[0], 'o1a', 'nejpodobnější pořád první');
  assert.ok(ids.indexOf('other') <= 2, `jiný kanál se dostane nahoru: ${ids}`);
  assert.equal(new Set(ids).size, 4);
  const seenLast = u.rankRelated(cands, cur, new Set(['o1a']), NOW).map((v) => v.id);
  assert.equal(seenLast[seenLast.length - 1], 'o1a', 'zhlédnuté pořád až na konci');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
