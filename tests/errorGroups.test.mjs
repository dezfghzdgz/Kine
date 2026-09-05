/**
 * Test seskupení chyb pro /admin/errors (lib/errorGroups.ts).
 * Spustit:  node tests/errorGroups.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/errorGroups.ts');
const { groupErrors } = await import(join(kam, 'errorGroups.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

function r(fp, at, extra = {}) {
  return { id: fp + at, created_at: at, kind: 'error', message: 'msg ' + fp, stack: null, url: '/watch/1', user_agent: 'UA', device: 'phone', fingerprint: fp, ...extra };
}

test('stejný otisk = jedna skupina s počtem, první a poslední výskyt', () => {
  const g = groupErrors([r('a', '2026-09-01T10:00:00Z'), r('a', '2026-09-03T10:00:00Z'), r('a', '2026-09-02T10:00:00Z')]);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 3);
  assert.equal(g[0].firstSeen, '2026-09-01T10:00:00Z');
  assert.equal(g[0].lastSeen, '2026-09-03T10:00:00Z');
});

test('nejčastější skupina napřed', () => {
  const g = groupErrors([r('a', '2026-09-01T10:00:00Z'), r('b', '2026-09-01T10:00:00Z'), r('b', '2026-09-01T11:00:00Z')]);
  assert.equal(g[0].fingerprint, 'b');
});

test('ukázka zásobníku je z nejnovějšího výskytu, který ho má', () => {
  const g = groupErrors([
    r('a', '2026-09-01T10:00:00Z', { stack: 'stary' }),
    r('a', '2026-09-03T10:00:00Z', { stack: null }),
    r('a', '2026-09-02T10:00:00Z', { stack: 'novejsi' }),
  ]);
  assert.equal(g[0].sampleStack, 'novejsi');
});

test('adresy a zařízení se sečtou, adres nejvíc pět', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(r('a', '2026-09-01T10:00:0' + (i % 10) + 'Z', { url: '/p' + i, device: i % 2 ? 'tv' : 'desktop' }));
  rows.push(r('a', '2026-09-01T11:00:00Z', { url: '/p0' }));
  const [g] = groupErrors(rows);
  assert.equal(g.urls.length, 5);
  assert.deepEqual(g.urls[0], { url: '/p0', count: 2 });
  assert.equal(g.devices.tv, 4);
  assert.equal(g.devices.desktop, 4);
  assert.equal(g.devices.phone, 1);
});

test('řádek bez otisku se seskupí podle textu a bez zařízení jde do "neznámé"', () => {
  const [g] = groupErrors([r('', '2026-09-01T10:00:00Z', { message: 'x', device: null }), r('', '2026-09-01T10:01:00Z', { message: 'x', device: null })]);
  assert.equal(g.count, 2);
  assert.equal(g.devices['neznámé'], 2);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
