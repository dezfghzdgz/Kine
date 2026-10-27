/**
 * Test odkazu na video z appek (lib/videoRef.ts), úklidu zaseklých videí
 * (lib/videoProcessing.ts) a kategorie z nahrání (lib/categories.ts).
 *
 * Proč: mobilní Kine Clipper do 0.4.1 se ptal na stav videa s id od
 * Cloudflare - Kine video nenašla a klip visel jako „zpracovává se“
 * (u Cloudflare byl, na Kine nikde).
 *
 * Spustit:  node tests/videoRef.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/videoRef.ts', 'lib/videoProcessing.ts', 'lib/categories.ts');
const r = await import(join(kam, 'videoRef.js'));
const p = await import(join(kam, 'videoProcessing.js'));
const c = await import(join(kam, 'categories.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const KINE = '3f2b8c1e-9a4d-4b7e-8f1a-2c3d4e5f6a7b';
const CF = '0123456789abcdef0123456789abcdef';

test('id na Kine (uuid) i id od Cloudflare (mobil do 0.4.1) se poznají', () => {
  assert.deepEqual(r.videoRefFrom(KINE), { kind: 'kine', id: KINE });
  assert.deepEqual(r.videoRefFrom(CF), { kind: 'cloudflare', uid: CF });
  assert.deepEqual(r.videoRefFrom(` ${CF.toUpperCase()} `), { kind: 'cloudflare', uid: CF }, 'mezery a velká písmena');
});

test('nic jiného do databáze nejde (nesmysl, SQL, prázdno, číslo)', () => {
  for (const bad of ['', 'abc', `${KINE}x`, "1' or '1'='1", CF.slice(1), null, undefined, 42, {}]) {
    assert.equal(r.videoRefFrom(bad), null, String(bad));
  }
  assert.equal(r.isKineVideoId(KINE), true);
  assert.equal(r.isKineVideoId(CF), false, 'id od Cloudflare není id na Kine');
});

test('nedokončené nahrání u Cloudflare se vzdá až po dni (ne dřív, ne u jiných stavů)', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(p.uploadNeverFinished('pendingupload', '2026-10-26T11:00:00Z', now), true);
  assert.equal(p.uploadNeverFinished('pendingupload', '2026-10-27T01:00:00Z', now), false, 'čerstvé');
  assert.equal(p.uploadNeverFinished('inprogress', '2026-10-01T00:00:00Z', now), false, 'zpracovává se');
  assert.equal(p.uploadNeverFinished('pendingupload', null, now), false, 'bez data nic');
});

test('úklid: nejnovější zaseklá napřed, pak nejstarší, bez opakování (staré nezablokují nové)', () => {
  const order = p.sweepOrder([{ id: 'n1' }, { id: 'n2' }, { id: 'o1' }], [{ id: 'o1' }, { id: 'o2' }]).map((x) => x.id);
  assert.deepEqual(order, ['n1', 'n2', 'o1', 'o2']);
  assert.deepEqual(p.sweepOrder(null, undefined), []);
  assert.deepEqual(p.sweepOrder([{ id: '' }, null], [{ id: 'a' }]).map((x) => x.id), ['a']);
});

test('kategorie z nahrání: klíč zůstane, "gaming" z mobilu = catGaming, neznámá = bez kategorie', () => {
  assert.equal(c.normalizeCategory('catGaming'), 'catGaming');
  assert.equal(c.normalizeCategory('gaming'), 'catGaming');
  assert.equal(c.normalizeCategory(' Music '), 'catMusic');
  assert.equal(c.normalizeCategory('catgaming'), 'catGaming');
  assert.equal(c.normalizeCategory('kočky'), null);
  assert.equal(c.normalizeCategory(''), null);
  assert.equal(c.normalizeCategory(null), null);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
