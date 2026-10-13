/**
 * Test odznaků na kanálu (lib/badges.ts).
 *
 * Spustit:  node tests/badges.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/badges.ts');
const b = await import(join(kam, 'badges.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2029-03-01T12:00:00Z');
const base = { joinedAt: '2028-06-01T00:00:00Z', videos: 0, views: 0, subscribers: 0, sparks: 0, streamed: false };
const ids = (stats) => b.computeBadges(stats, NOW).map((x) => `${x.id}:${x.value}`);

test('nový účet bez videí: žádný odznak', () => {
  assert.deepEqual(ids(base), []);
});

test('od každé řady jen nejvyšší stupeň, seřazené (odběratelé, zhlédnutí, videa, Sparks, živě, roky, průkopník)', () => {
  const stats = { joinedAt: '2026-10-01T00:00:00Z', videos: 57, views: 12_345, subscribers: 1_000, sparks: 12, streamed: true };
  assert.deepEqual(ids(stats), ['subscribers:1000', 'views:10000', 'videos:50', 'sparks:10', 'streamer:1', 'years:2', 'early:1']);
});

test('hranice: přesně na hranici = má, o jedna méně = nemá', () => {
  assert.deepEqual(ids({ ...base, videos: 1 }), ['videos:1']);
  assert.deepEqual(ids({ ...base, views: 999 }), []);
  assert.deepEqual(ids({ ...base, views: 1000 }), ['views:1000']);
  assert.deepEqual(ids({ ...base, subscribers: 99 }), []);
  assert.deepEqual(ids({ ...base, sparks: 9 }), []);
});

test('roky na Kine a průkopník (registrace do konce 2026)', () => {
  assert.equal(b.yearsOnKine('2028-03-02T00:00:00Z', NOW), 0);
  assert.equal(b.yearsOnKine('2028-02-28T00:00:00Z', NOW), 1);
  assert.equal(b.yearsOnKine('nesmysl', NOW), 0);
  assert.equal(b.yearsOnKine('2030-01-01T00:00:00Z', NOW), 0);
  assert.deepEqual(ids({ ...base, joinedAt: '2026-12-31T23:00:00Z' }), ['years:2', 'early:1']);
  assert.deepEqual(ids({ ...base, joinedAt: '2027-01-01T00:00:00Z' }), ['years:2']);
});

test('nesmyslná čísla nespadnou', () => {
  assert.deepEqual(ids({ ...base, videos: -5, views: NaN, subscribers: Infinity, sparks: 'x' }), []);
});

test('další odznak: ten nejblíž splněný; Sparks jen když nějaké jsou; null když má všechno', () => {
  // 800/1000 zhlédnutí (80 %) je blíž než 3/10 videí (30 %)
  assert.deepEqual(b.nextBadge({ ...base, videos: 3, views: 800 }, NOW), { id: 'views', target: 1000, current: 800, missing: 200 });
  // nic nemá -> první video (0/1) i 0 zhlédnutí - vyhraje první v pořadí se stejným poměrem
  assert.equal(b.nextBadge(base, NOW).id, 'videos');
  assert.equal(b.nextBadge({ ...base, videos: 2, sparks: 0 }, NOW).id !== 'sparks', true);
  assert.equal(b.nextBadge({ ...base, videos: 1, sparks: 9 }, NOW).id, 'sparks');
  const max = { ...base, videos: 1e9, views: 1e12, subscribers: 1e9, sparks: 1e9 };
  assert.equal(b.nextBadge(max, NOW), null);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
