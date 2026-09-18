/**
 * Test rozkladu barvy appky na složky (lib/brandColor.ts).
 *
 * Spustit:  node tests/brandColor.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/brandColor.ts');
const { hexToRgbTriplet } = await import(join(kam, 'brandColor.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('šestimístný hex (fialová z loga, přednastavené barvy)', () => {
  assert.equal(hexToRgbTriplet('#a34ff7'), '163, 79, 247');
  assert.equal(hexToRgbTriplet('#00c9a7'), '0, 201, 167');
  assert.equal(hexToRgbTriplet('#ffffff'), '255, 255, 255');
  assert.equal(hexToRgbTriplet('#000000'), '0, 0, 0');
});

test('velká písmena, mezery a chybějící mřížka nevadí', () => {
  assert.equal(hexToRgbTriplet('  #A34FF7 '), '163, 79, 247');
  assert.equal(hexToRgbTriplet('a34ff7'), '163, 79, 247');
});

test('krátký zápis a zápis s průhledností', () => {
  assert.equal(hexToRgbTriplet('#af7'), '170, 255, 119');
  assert.equal(hexToRgbTriplet('#a34ff780'), '163, 79, 247');
});

test('nesmysl -> null (sklo pak zůstane u výchozí barvy)', () => {
  assert.equal(hexToRgbTriplet('rgb(1,2,3)'), null);
  assert.equal(hexToRgbTriplet('#12345'), null);
  assert.equal(hexToRgbTriplet('#gggggg'), null);
  assert.equal(hexToRgbTriplet(''), null);
  assert.equal(hexToRgbTriplet(null), null);
  assert.equal(hexToRgbTriplet(undefined), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
