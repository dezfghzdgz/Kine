/**
 * Test navigace šipkami (lib/spatialNav.ts) a režimu televize (lib/tvMode.ts).
 *
 * Geometrie výběru dalšího prvku - to, co na televizi rozhoduje, jestli
 * šipka doprava skočí na sousední kartu, nebo někam šikmo.
 *
 * Spustit:  node tests/spatialNav.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/spatialNav.ts', 'lib/tvMode.ts', 'lib/deviceClass.ts');
const tv = join(kam, 'tvMode.js');
writeFileSync(tv, readFileSync(tv, 'utf8').replace("'./deviceClass'", "'./deviceClass.js'"));
const { pickNext, isInDirection, moveCost, directionOfKey, isBackKey } = await import(join(kam, 'spatialNav.js'));
const { resolveTvMode } = await import(tv);

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

// Mřížka 3x2 karet 300x200 s mezerou 20, začíná na (0,0).
function karta(radek, sloupec) {
  const left = sloupec * 320, top = radek * 220;
  return { rect: { left, top, right: left + 300, bottom: top + 200 }, item: `r${radek}s${sloupec}` };
}
const mrizka = [];
for (let r = 0; r < 2; r++) for (let s = 0; s < 3; s++) mrizka.push(karta(r, s));
const od = (r, s) => karta(r, s).rect;
const jine = (r, s) => mrizka.filter((c) => c.item !== `r${r}s${s}`);

test('doprava skočí na sousední kartu v řadě, ne šikmo', () => {
  assert.equal(pickNext(od(0, 0), jine(0, 0), 'right').item, 'r0s1');
  assert.equal(pickNext(od(0, 1), jine(0, 1), 'right').item, 'r0s2');
});

test('dolů skočí na kartu přímo pod, doleva a nahoru zpět', () => {
  assert.equal(pickNext(od(0, 1), jine(0, 1), 'down').item, 'r1s1');
  assert.equal(pickNext(od(1, 1), jine(1, 1), 'up').item, 'r0s1');
  assert.equal(pickNext(od(0, 2), jine(0, 2), 'left').item, 'r0s1');
});

test('na kraji řady doprava není kam - nic se nestane (žádné přetečení na další řádek)', () => {
  assert.equal(pickNext(od(0, 2), jine(0, 2), 'right'), null);
  assert.equal(pickNext(od(1, 0), jine(1, 0), 'left'), null);
  assert.equal(pickNext(od(1, 1), jine(1, 1), 'down'), null);
});

test('prvek v jedné řadě má přednost před bližším, ale vybočeným', () => {
  const from = { left: 0, top: 0, right: 300, bottom: 200 };
  const vRade = { rect: { left: 700, top: 0, right: 1000, bottom: 200 }, item: 'v rade daleko' };
  const sikmo = { rect: { left: 320, top: 260, right: 620, bottom: 460 }, item: 'sikmo blizko' };
  assert.equal(pickNext(from, [vRade, sikmo], 'right').item, 'v rade daleko');
});

test('boční menu vlevo od obsahu: doleva z první karty skočí do menu, ne na nic jiného', () => {
  const menu = { rect: { left: -240, top: 60, right: -20, bottom: 100 }, item: 'menu' };
  assert.equal(pickNext(od(0, 0), [...jine(0, 0), menu], 'left').item, 'menu');
});

test('prvek uvnitř aktuálního (tlačítka přehrávače) není "dole" ani "nahoře"', () => {
  const player = { left: 0, top: 0, right: 800, bottom: 450 };
  const tlacitko = { left: 10, top: 400, right: 50, bottom: 440 };
  assert.equal(isInDirection(player, tlacitko, 'down'), false);
  assert.equal(isInDirection(player, tlacitko, 'up'), false);
});

test('cena roste s vybočením a se vzdáleností', () => {
  const from = { left: 0, top: 0, right: 100, bottom: 100 };
  const blizko = { left: 120, top: 0, right: 220, bottom: 100 };
  const daleko = { left: 400, top: 0, right: 500, bottom: 100 };
  assert.ok(moveCost(from, blizko, 'right') < moveCost(from, daleko, 'right'));
});

test('klávesy: jména i číselné kódy z televizí, tlačítko Zpět', () => {
  assert.equal(directionOfKey('ArrowRight', 0), 'right');
  assert.equal(directionOfKey('', 38), 'up');
  assert.equal(directionOfKey('Enter', 13), null);
  assert.equal(isBackKey('', 10009), true, 'Tizen');
  assert.equal(isBackKey('', 461), true, 'webOS');
  assert.equal(isBackKey('Escape', 27), true);
  assert.equal(isBackKey('Enter', 13), false);
});

test('režim televize: adresa > ruční volba > automatika', () => {
  assert.equal(resolveTvMode({ preference: 'auto', looksLikeTv: false, urlParam: null }), false);
  assert.equal(resolveTvMode({ preference: 'auto', looksLikeTv: true, urlParam: null }), true);
  assert.equal(resolveTvMode({ preference: 'off', looksLikeTv: true, urlParam: null }), false, 'ruční vypnutí přebije televizi');
  assert.equal(resolveTvMode({ preference: 'on', looksLikeTv: false, urlParam: null }), true);
  assert.equal(resolveTvMode({ preference: 'off', looksLikeTv: false, urlParam: '1' }), true, '?tv=1 přebije všechno');
  assert.equal(resolveTvMode({ preference: 'on', looksLikeTv: true, urlParam: '0' }), false);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
