/**
 * Test rozhodování mini přehrávače (lib/miniPlayer.ts).
 *
 * Mini okno se má objevit jen když divák odroluje pod video, a nemá
 * otravovat po zavření, v režimu televize ani u hudby.
 *
 * Spustit:  node tests/miniPlayer.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/miniPlayer.ts');
const { decideMiniPlayer, digitSeekTarget, MINI_PLAYER_HIDE_RATIO } = await import(join(kam, 'miniPlayer.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const klid = { dismissed: false, tv: false, musicMode: false };

test('krabice celá vidět -> žádné mini', () => {
  const d = decideMiniPlayer({ ratio: 1, top: 80, ...klid });
  assert.deepEqual(d, { boxVisible: true, mini: false });
});

test('odrolovaná nahoru a skoro pryč -> mini', () => {
  const d = decideMiniPlayer({ ratio: 0.1, top: -400, ...klid });
  assert.deepEqual(d, { boxVisible: false, mini: true });
});

test('odrolovaná nahoru, ale ještě dost vidět -> zůstává v krabici', () => {
  const d = decideMiniPlayer({ ratio: MINI_PLAYER_HIDE_RATIO, top: -200, ...klid });
  assert.equal(d.boxVisible, true);
  assert.equal(d.mini, false);
});

test('krabice POD oknem (skok na komentář) -> žádné mini, přehrávač by se zdvojil', () => {
  const d = decideMiniPlayer({ ratio: 0, top: 1200, ...klid });
  assert.deepEqual(d, { boxVisible: true, mini: false });
});

test('po zavření křížkem se mini nevrací, dokud krabice není vidět', () => {
  const pryc = decideMiniPlayer({ ratio: 0, top: -600, ...klid, dismissed: true });
  assert.equal(pryc.mini, false);
  assert.equal(pryc.boxVisible, false);
  // ...a jakmile je krabice vidět, volající zavření zapomene - to hlídá
  // boxVisible, které tady musí být pravda.
  const zpet = decideMiniPlayer({ ratio: 0.9, top: 10, ...klid, dismissed: true });
  assert.equal(zpet.boxVisible, true);
});

test('režim televize a hudba mini nikdy nezapnou', () => {
  assert.equal(decideMiniPlayer({ ratio: 0, top: -600, ...klid, tv: true }).mini, false);
  assert.equal(decideMiniPlayer({ ratio: 0, top: -600, ...klid, musicMode: true }).mini, false);
});

test('číslice skáčou na desetiny délky', () => {
  assert.equal(digitSeekTarget(0, 600), 0);
  assert.equal(digitSeekTarget(5, 600), 300);
  assert.equal(digitSeekTarget(9, 600), 540);
});

test('číslice bez známé délky nebo mimo 0-9 nedělají nic', () => {
  assert.equal(digitSeekTarget(5, 0), null);
  assert.equal(digitSeekTarget(5, NaN), null);
  assert.equal(digitSeekTarget(10, 600), null);
  assert.equal(digitSeekTarget(-1, 600), null);
  assert.equal(digitSeekTarget(1.5, 600), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
