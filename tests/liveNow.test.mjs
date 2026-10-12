/**
 * Test řady "Živě" (lib/liveNow.ts): kdo se ukáže a v jakém pořadí.
 *
 * Spustit:  node tests/liveNow.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveNow.ts');
const { arrangeLiveNow, LIVE_NOW_SHUFFLE_MS } = await import(join(kam, 'liveNow.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const T0 = Date.parse('2026-10-11T20:00:00Z');
const row = (id, minAgo) => ({ owner_id: id, started_at: new Date(T0 - minAgo * 60000).toISOString() });
const prof = (id, extra = {}) => ({ id, username: id, display_name: null, avatar_url: null, verification_tier: null, is_banned: false, is_shadow_banned: false, ...extra });
const profiles = (...list) => new Map(list.map((p) => [p.id, p]));
const ids = (out) => out.map((x) => x.row.owner_id);

test('zablokovaný kanál nevidí nikdo, shadow-banovaný jen majitel', () => {
  const rows = [row('a', 5), row('ban', 3), row('shadow', 1)];
  const map = profiles(prof('a'), prof('ban', { is_banned: true }), prof('shadow', { is_shadow_banned: true }));
  assert.deepEqual(ids(arrangeLiveNow(rows, map, { now: T0 })), ['a']);
  assert.deepEqual(ids(arrangeLiveNow(rows, map, { now: T0, viewerId: 'shadow' })).sort(), ['a', 'shadow']);
  assert.deepEqual(ids(arrangeLiveNow(rows, map, { now: T0, viewerId: 'ban' })), ['a']);
});

test('bez sloupců o blokaci (starší databáze) se kanál ukáže', () => {
  const map = new Map([['x', { id: 'x', username: 'x', display_name: null, avatar_url: null, verification_tier: null }]]);
  assert.deepEqual(ids(arrangeLiveNow([row('x', 1)], map, { now: T0 })), ['x']);
});

test('vlastní přenos první, pak odebírané (nejnovější první), pak ostatní', () => {
  const rows = [row('o1', 1), row('f1', 50), row('me', 30), row('o2', 2), row('f2', 5)];
  const map = profiles(prof('o1'), prof('f1'), prof('me'), prof('o2'), prof('f2'));
  const out = ids(arrangeLiveNow(rows, map, { now: T0, viewerId: 'me', followed: new Set(['f1', 'f2']) }));
  assert.deepEqual(out.slice(0, 3), ['me', 'f2', 'f1']);
  assert.deepEqual(out.slice(3).sort(), ['o1', 'o2']);
});

test('ostatní se míchají po 10 minutách - pořadí se mezi obnovením nemění, časem ano', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`c${i}`, i));
  const map = profiles(...rows.map((r) => prof(r.owner_id)));
  const a = ids(arrangeLiveNow(rows, map, { now: T0 }));
  const b = ids(arrangeLiveNow(rows, map, { now: T0 + 20000 }));
  assert.deepEqual(a, b, 'stejné pořadí během 10 minut');
  const orders = new Set();
  for (let k = 0; k < 6; k++) orders.add(ids(arrangeLiveNow(rows, map, { now: T0 + k * LIVE_NOW_SHUFFLE_MS }))[0]);
  assert.ok(orders.size > 1, 'na první místo se časem dostane někdo jiný');
});

test('bez profilu se přenos nevypíše, dvojí řádek jen jednou, strop 24', () => {
  const rows = [row('a', 1), row('a', 2), row('nobody', 1), ...Array.from({ length: 30 }, (_, i) => row(`z${i}`, i))];
  const map = profiles(prof('a'), ...Array.from({ length: 30 }, (_, i) => prof(`z${i}`)));
  const out = ids(arrangeLiveNow(rows, map, { now: T0 }));
  assert.equal(out.length, 24);
  assert.equal(out.filter((x) => x === 'a').length <= 1, true);
  assert.equal(out.includes('nobody'), false);
});

test('tým Kine (moderátoři, správci) vidí i zablokované a shadow-banované - s popiskem proč', () => {
  const rows = [row('a', 5), row('ban', 3), row('shadow', 1)];
  const map = profiles(prof('a'), prof('ban', { is_banned: true }), prof('shadow', { is_shadow_banned: true }));
  const out = arrangeLiveNow(rows, map, { now: T0, staff: true });
  assert.deepEqual(ids(out).sort(), ['a', 'ban', 'shadow']);
  const why = Object.fromEntries(out.map((x) => [x.row.owner_id, x.restricted]));
  assert.deepEqual(why, { a: null, ban: 'banned', shadow: 'shadow-ban' });
  // majitel svůj shadow-ban nepozná (popisek nedostane), ostatní ho nevidí vůbec
  const own = arrangeLiveNow(rows, map, { now: T0, viewerId: 'shadow' });
  assert.equal(own.find((x) => x.row.owner_id === 'shadow').restricted, null);
  assert.ok(arrangeLiveNow(rows, map, { now: T0 }).every((x) => x.restricted === null));
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
