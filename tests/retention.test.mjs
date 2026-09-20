/**
 * Test křivky udržení (lib/retention.ts).
 *
 * Spustit:  node tests/retention.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/retention.ts');
const { retentionCurve, retentionSummary, biggestDrop } = await import(join(kam, 'retention.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const rows = (list) => list.map((p) => ({ progress_seconds: p }));

test('polovina diváků odpadne v půlce: křivka 100 % -> 50 %', () => {
  const pts = retentionCurve(rows([100, 100, 100, 100, 30, 30, 30, 30]), 100, 4);
  assert.deepEqual(pts.map((p) => [p.at, p.share]), [[0, 1], [25, 1], [50, 0.5], [75, 0.5]]);
});

test('první dílek je vždy 100 %, i když někdo skončil na nule', () => {
  const pts = retentionCurve(rows([0, 0, 50]), 100, 2);
  assert.equal(pts[0].share, 1);
  assert.equal(pts[1].share, 1 / 3);
});

test('dokoukané řádky se počítají jako celé video, i s nižším progressem', () => {
  const pts = retentionCurve([{ progress_seconds: 10, completed: true }, { progress_seconds: 10, completed: false }], 100, 4);
  assert.equal(pts[3].share, 0.5);
});

test('progress za délkou videa se ořízne, nesmysly se vyhodí', () => {
  const pts = retentionCurve(rows([500, null, NaN, -3, 40]), 100, 2);
  // Platné: 500->100 a 40; druhý dílek (od 50 s) dosáhl jen ten první.
  assert.equal(pts[1].share, 0.5);
});

test('bez dat nebo bez délky je křivka prázdná', () => {
  assert.deepEqual(retentionCurve([], 100), []);
  assert.deepEqual(retentionCurve(rows([10]), 0), []);
  assert.deepEqual(retentionCurve(rows([null]), 100), []);
});

test('souhrn: půlka a konec', () => {
  const pts = retentionCurve(rows([100, 100, 60, 20]), 100, 4);
  assert.deepEqual(retentionSummary(pts), { half: 0.75, end: 0.5 });
  assert.equal(retentionSummary([]), null);
});

test('největší propad: kde lidi odpadají', () => {
  const pts = retentionCurve(rows([100, 100, 100, 100, 30, 30, 30, 30, 10, 10]), 100, 10);
  const drop = biggestDrop(pts);
  // Dílky po 10 s. Dva diváci skončili v 10 s (odpadnou mezi 10 a 20 s:
  // propad 0,2), čtyři ve 30 s (odpadnou mezi 30 a 40 s: propad 0,4).
  // Největší propad tedy začíná ve 30 s.
  assert.equal(drop.at, 30);
  assert.ok(Math.abs(drop.drop - 0.4) < 1e-9);
  assert.equal(biggestDrop(retentionCurve(rows([100, 100]), 100, 4)), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
