/**
 * Test pruhu Sparks (lib/sparksShelf.ts): řádek vyplní celou šířku.
 *
 * Spustit:  node tests/sparksShelf.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/sparksShelf.ts');
const s = await import(join(kam, 'sparksShelf.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const cardWidth = (width, cols) => (width - (cols - 1) * s.SHELF_GAP_PX) / cols;

test('široký monitor: řádek až ke kraji (dřív 6 karet a vpravo prázdno)', () => {
  const { cols, rows } = s.sparksShelfColumns(1700, 12);
  assert.equal(rows, 1);
  assert.ok(cols >= 7, `${cols} sloupců`);
  const w = cardWidth(1700, cols);
  assert.ok(w >= 200 && w <= 280, `karta ${w} px`);
});

test('karty nikdy menší než 200 px na počítači ani větší než 280 px', () => {
  for (const width of [1100, 1280, 1440, 1920, 2560, 3440]) {
    const { cols } = s.sparksShelfColumns(width, 40);
    const w = cardWidth(width, cols);
    assert.ok(w >= 200 && w <= 280 + 1e-9 || cols === 1, `${width}: ${cols} sloupců po ${w} px`);
  }
});

test('málo Sparks: karty se zvětší (nejvýš 280 px), ale řádek se nepřetáhne', () => {
  const { cols } = s.sparksShelfColumns(1700, 3);
  assert.ok(cols >= 3, `${cols}`);
  assert.ok(cardWidth(1700, cols) <= 280);
});

test('telefon: dvě vedle sebe, dva řádky', () => {
  assert.deepEqual(s.sparksShelfColumns(380, 12), { cols: 2, rows: 2 });
});

test('nesmysl (nulová šířka) nespadne', () => {
  assert.deepEqual(s.sparksShelfColumns(0, 5), { cols: 2, rows: 1 });
  assert.deepEqual(s.sparksShelfColumns(NaN, 5), { cols: 2, rows: 1 });
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
