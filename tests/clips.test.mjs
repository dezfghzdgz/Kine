/**
 * Test rozhodování o klipech (lib/clips.ts).
 *
 * Spustit:  node tests/clips.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/clips.ts', 'lib/playerControls.ts');
const { normalizeClipRange, defaultClipRange, clipTitle, parseClipTime, CLIP_MAX_S, CLIP_MIN_S } = await import(join(kam, 'clips.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('rozsah v pořádku se zaokrouhlí na celé sekundy', () => {
  assert.deepEqual(normalizeClipRange(10.4, 40.2, 731), { ok: true, start: 10, end: 41 });
});

test('začátek pod nulou a konec za koncem videa se oříznou', () => {
  assert.deepEqual(normalizeClipRange(-5, 20, 731), { ok: true, start: 0, end: 20 });
  assert.deepEqual(normalizeClipRange(700, 999, 731), { ok: true, start: 700, end: 731 });
});

test('příliš krátký a příliš dlouhý klip jsou chyba, ne tiché zkrácení', () => {
  assert.deepEqual(normalizeClipRange(10, 12, 731), { ok: false, reason: 'too-short' });
  assert.deepEqual(normalizeClipRange(10, 10 + CLIP_MAX_S + 1, 731), { ok: false, reason: 'too-long' });
  assert.equal(normalizeClipRange(10, 10 + CLIP_MAX_S, 731).ok, true);
  assert.equal(normalizeClipRange(10, 10 + CLIP_MIN_S, 731).ok, true);
});

test('nesmysly: konec před začátkem, začátek za koncem, NaN, nulová délka', () => {
  assert.deepEqual(normalizeClipRange(40, 10, 731), { ok: false, reason: 'too-short' });
  assert.deepEqual(normalizeClipRange(800, 830, 731), { ok: false, reason: 'out-of-range' });
  assert.deepEqual(normalizeClipRange(NaN, 10, 731), { ok: false, reason: 'invalid' });
  assert.deepEqual(normalizeClipRange(0, 10, 0), { ok: false, reason: 'invalid' });
});

test('výchozí rozsah = posledních 30 s před aktuálním časem', () => {
  assert.deepEqual(defaultClipRange(100, 731), { start: 70, end: 100 });
  // Na začátku videa: prvních 30 s.
  assert.deepEqual(defaultClipRange(0, 731), { start: 0, end: 30 });
  assert.deepEqual(defaultClipRange(12, 731), { start: 0, end: 30 });
  // Krátké video: celé.
  assert.deepEqual(defaultClipRange(8, 20), { start: 0, end: 20 });
  // Po konci videa: posledních 30 s.
  assert.deepEqual(defaultClipRange(9999, 731), { start: 701, end: 731 });
});

test('název klipu s časy, dlouhý název se zkrátí pod 150 znaků', () => {
  assert.equal(clipTitle('chill cs game play', 70, 100), 'chill cs game play · 1:10–1:40');
  const dlouhy = clipTitle('x'.repeat(200), 3600, 3630);
  assert.ok(dlouhy.length <= 150, 'délka ' + dlouhy.length);
  assert.ok(dlouhy.endsWith(' · 1:00:00–1:00:30'));
  assert.equal(clipTitle('', 0, 10), 'Video · 0:00–0:10');
});

test('čas z textu', () => {
  assert.equal(parseClipTime('1:10'), 70);
  assert.equal(parseClipTime('1:02:03'), 3723);
  assert.equal(parseClipTime('45'), 45);
  assert.equal(parseClipTime(' 0:05 '), 5);
  assert.equal(parseClipTime('abc'), null);
  assert.equal(parseClipTime('1:'), null);
  assert.equal(parseClipTime('1:2:3:4'), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
