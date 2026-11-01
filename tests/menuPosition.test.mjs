/**
 * Nabídka ⋮ u karty videa (lib/menuPosition.ts): vždy celá v okně - nad tečky,
 * nebo pod ně, kde je víc místa; nikdy přes okraj.
 * Spustit:  node tests/menuPosition.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/menuPosition.ts');
const { panelPosition, PANEL_WIDTH, PANEL_MAX_HEIGHT } = await import(join(kam, 'menuPosition.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const VW = 1280;
const VH = 900;
const btn = (top, right = 600) => ({ top, bottom: top + 26, right });

test('dole na stránce: nabídka nad tečkami, celá vidět', () => {
  const p = panelPosition(btn(700), 300, VW, VH);
  assert.equal(p.top, null);
  assert.equal(p.bottom, VH - 700 + 6);
  assert.ok(p.maxHeight >= 300);
});

test('karta nahoře (řada Pokračovat ve sledování): nabídka pod tečky, ne mimo okno', () => {
  const p = panelPosition(btn(230), 330, VW, VH);
  assert.equal(p.bottom, null, 'nad tečkami je jen 216 px - dolů');
  assert.equal(p.top, 230 + 26 + 6);
  assert.ok(p.top + p.maxHeight <= VH - 8, 'nevyleze dolů z okna');
});

test('málo místa nahoře i dole (malé okno): kam je víc místa, výška zkrácená', () => {
  const p = panelPosition(btn(150), 340, VW, 420);
  assert.equal(p.bottom, null);
  assert.ok(p.maxHeight <= 420 - (150 + 26 + 6) - 8 + 1);
  const q = panelPosition(btn(300), 340, VW, 420);
  assert.equal(q.top, null, 'nahoře víc místa');
  assert.ok(q.maxHeight <= 300 - 6 - 8);
});

test('vodorovně: k pravému kraji teček, ale nikdy přes okraj okna', () => {
  assert.equal(panelPosition(btn(700, 600), 200, VW, VH).left, 600 - PANEL_WIDTH);
  assert.equal(panelPosition(btn(700, 100), 200, VW, VH).left, 8, 'u levého kraje');
  assert.equal(panelPosition(btn(700, 1279), 200, VW, VH).left, VW - PANEL_WIDTH - 8, 'u pravého kraje okna 8 px rezerva');
  assert.equal(panelPosition(btn(700, 300), 200, 390, VH).left, 300 - PANEL_WIDTH);
  assert.ok(panelPosition(btn(700, 390), 200, 390, VH).left + PANEL_WIDTH <= 390 - 8 + 1e-9);
});

test('výška nikdy přes strop a nesmyslná výška nic nerozbije', () => {
  assert.ok(panelPosition(btn(800), 5000, VW, 2000).maxHeight <= PANEL_MAX_HEIGHT);
  const p = panelPosition(btn(500), NaN, VW, VH);
  assert.ok(Number.isFinite(p.maxHeight) && Number.isFinite(p.left));
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
