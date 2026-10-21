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

test('seznam vedle videa: nezhlédnutá napřed, zhlédnutá za nimi', () => {
  assert.deepEqual(u.unseenFirst(list.filter((v) => v.id !== 'now'), new Set(['a', 'c'])).map((v) => v.id), ['b', 'd', 'e', 'a', 'c']);
});

test('paměť zhlédnutých: nejnovější napřed, bez opakování, se stropem', () => {
  assert.deepEqual(u.addSeen(['x', 'y'], 'y'), ['y', 'x']);
  assert.deepEqual(u.addSeen([], 'z'), ['z']);
  assert.equal(u.addSeen(Array.from({ length: 600 }, (_, i) => `v${i}`), 'new').length, u.SEEN_MAX);
  assert.deepEqual(u.addSeen(['a'], ''), ['a']);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
