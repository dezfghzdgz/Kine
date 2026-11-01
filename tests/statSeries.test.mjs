/**
 * Grafy statistik (lib/statSeries.ts): body s váhou, součty po dnech,
 * kumulativní řada a "za posledních 28 dní".
 * Spustit:  node tests/statSeries.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/statSeries.ts');
const { pointsFromDates, pointsFromDaily, recentTotal, totalOf, cumulativeSeries } = await import(join(kam, 'statSeries.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const DAY = 86400000;
const NOW = Date.parse('2026-10-20T12:00:00Z');

test('data -> body s váhou 1, neplatná pryč', () => {
  const p = pointsFromDates([new Date(NOW), '2026-10-01T00:00:00Z', 'nesmysl', null, undefined]);
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => x.n === 1));
});

test('součty po dnech z databáze -> jeden bod za den (poledne místního času)', () => {
  const p = pointsFromDaily([['2026-10-02', 3], ['2026-10-03', '5000'], ['spatne', 1], ['2026-10-04', 0], 'x', ['2026-10-05', -2]]);
  assert.equal(p.length, 2);
  assert.equal(totalOf(p), 5003);
  const d = new Date(p[0].t);
  assert.equal(d.getDate(), 2);
  assert.equal(d.getHours(), 12);
  assert.deepEqual(pointsFromDaily(null), []);
});

test('za posledních 28 dní sčítá váhy', () => {
  const p = [{ t: NOW - 2 * DAY, n: 10 }, { t: NOW - 27 * DAY, n: 5 }, { t: NOW - 40 * DAY, n: 100 }, { t: NOW + DAY, n: 7 }];
  assert.equal(recentTotal(p, 28, NOW), 15, 'budoucí a starší se nepočítají');
});

test('kumulativní řada: roste, končí celkovým součtem, poslední bod = teď', () => {
  const p = [{ t: NOW - 20 * DAY, n: 2 }, { t: NOW - 5 * DAY, n: 3 }, { t: NOW - DAY, n: 1000 }];
  const s = cumulativeSeries(p, 'month', NOW);
  assert.equal(s[s.length - 1].count, 1005);
  assert.equal(s[s.length - 1].isNow, true);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].count >= s[i - 1].count, 'neklesá');
  assert.equal(s[0].count, 0, 'před první událostí nic');
  assert.equal(s.length, 32, '31 dní + teď');
});

test('kumulativní řada odpovídá staré verzi (počítání po jedné události)', () => {
  const dates = Array.from({ length: 300 }, (_, i) => NOW - ((i * 7919) % (400 * DAY)));
  const p = dates.map((t) => ({ t, n: 1 }));
  for (const range of ['week', 'month', 'year', 'all']) {
    const s = cumulativeSeries(p, range, NOW);
    for (const point of s) {
      const old = dates.filter((t) => t <= point.t).length;
      assert.equal(point.count, old, `${range} @ ${new Date(point.t).toISOString()}`);
    }
  }
});

test('hodně starý kanál: nejvýš ~400 bodů', () => {
  const s = cumulativeSeries([{ t: NOW - 20 * 365 * DAY, n: 1 }], 'all', NOW);
  assert.ok(s.length <= 402, String(s.length));
  assert.deepEqual(cumulativeSeries([], 'all', NOW), []);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
