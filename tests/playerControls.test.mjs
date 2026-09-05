/**
 * Test rozhodování ovládací lišty přehrávače (lib/playerControls.ts).
 *
 * Lišta (components/ChapterTimeline.tsx) dostala dotykové chování a tohle
 * je to, co by na telefonu zlobilo nejvíc: dvojité klepnutí na kraj
 * (posun o 10 s), zápis času a otočení telefonu do celé obrazovky.
 *
 * Spustit:  node tests/playerControls.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/playerControls.ts');
const {
  formatTime, tapSide, decideTap, clampSeek, decideOrientationFullscreen,
  DOUBLE_TAP_MS, DOUBLE_TAP_SEEK_S,
} = await import(join(kam, 'playerControls.js'));

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

/* ---------- čas ---------- */

test('čas se píše jako na YouTube', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(7), '0:07');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3600 + 2 * 60 + 3), '1:02:03');
  assert.equal(formatTime(59.9), '0:59', 'zaokrouhluje dolů, ne nahoru');
});

test('nesmyslný čas od přehrávače se ukáže jako nula, ne jako NaN:NaN', () => {
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(Infinity), '0:00');
});

/* ---------- posuvník ---------- */

test('cílový čas zůstane uvnitř videa', () => {
  assert.equal(clampSeek(-5, 100), 0);
  assert.equal(clampSeek(120, 100), 100);
  assert.equal(clampSeek(50, 100), 50);
  assert.equal(clampSeek(50, 0), 50, 'neznámá délka omezuje jen zdola');
  assert.equal(clampSeek(NaN, 100), 0);
});

/* ---------- klepnutí ---------- */

test('kraje videa jsou po 35 %, střed zbytek', () => {
  assert.equal(tapSide(10, 1000), 'left');
  assert.equal(tapSide(349, 1000), 'left');
  assert.equal(tapSide(500, 1000), 'center');
  assert.equal(tapSide(651, 1000), 'right');
  assert.equal(tapSide(990, 1000), 'right');
  assert.equal(tapSide(5, 0), 'center', 'bez šířky nic nehádá');
});

test('první klepnutí je vždycky jednoduché', () => {
  const r = decideTap(null, { time: 1000, side: 'right' });
  assert.deepEqual(r, { kind: 'single', side: 'right' });
});

test('dvě rychlá klepnutí vpravo posunou o 10 s dopředu, vlevo zpět', () => {
  const vpravo = decideTap({ time: 1000, side: 'right' }, { time: 1000 + DOUBLE_TAP_MS - 20, side: 'right' });
  assert.deepEqual(vpravo, { kind: 'double', side: 'right', seekBy: DOUBLE_TAP_SEEK_S });

  const vlevo = decideTap({ time: 1000, side: 'left' }, { time: 1200, side: 'left' });
  assert.deepEqual(vlevo, { kind: 'double', side: 'left', seekBy: -DOUBLE_TAP_SEEK_S });
});

test('pomalá dvě klepnutí nejsou dvojité', () => {
  const r = decideTap({ time: 1000, side: 'right' }, { time: 1000 + DOUBLE_TAP_MS + 1, side: 'right' });
  assert.equal(r.kind, 'single');
});

test('klepnutí na dvě různé strany není dvojité', () => {
  const r = decideTap({ time: 1000, side: 'left' }, { time: 1100, side: 'right' });
  assert.equal(r.kind, 'single', 'jinak by "vlevo, vpravo" poskočilo o 10 s');
});

test('dvojité klepnutí uprostřed neposouvá - uprostřed se zastavuje', () => {
  const r = decideTap({ time: 1000, side: 'center' }, { time: 1100, side: 'center' });
  assert.deepEqual(r, { kind: 'single', side: 'center' });
});

/* ---------- otočení telefonu ---------- */

test('otočení na šířku dá video na celou obrazovku', () => {
  assert.equal(decideOrientationFullscreen({ landscapePhone: true, isFullscreen: false, autoEntered: false }), 'enter');
});

test('na šířku, když už je celá obrazovka, se nic nemění', () => {
  assert.equal(decideOrientationFullscreen({ landscapePhone: true, isFullscreen: true, autoEntered: false }), 'keep');
  assert.equal(decideOrientationFullscreen({ landscapePhone: true, isFullscreen: true, autoEntered: true }), 'keep');
});

test('otočení zpět na výšku vrátí jen to, co otočení samo zapnulo', () => {
  assert.equal(decideOrientationFullscreen({ landscapePhone: false, isFullscreen: true, autoEntered: true }), 'exit');
  assert.equal(decideOrientationFullscreen({ landscapePhone: false, isFullscreen: true, autoEntered: false }), 'keep',
    'celou obrazovku zapnutou tlačítkem otočení nesmí sebrat');
  assert.equal(decideOrientationFullscreen({ landscapePhone: false, isFullscreen: false, autoEntered: false }), 'keep');
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
