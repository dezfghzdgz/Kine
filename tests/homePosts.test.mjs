/**
 * Test řady „Novinky od tvých kanálů“ (lib/homePosts.ts): co se na hlavní
 * stránce ukáže - jen nové, neotevřené, ne vlastní, max 2 na kanál, a co
 * udělá „Skrýt“ a vypnutí v Nastavení.
 *
 * Spustit:  node tests/homePosts.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/homePosts.ts');
const hp = await import(join(kam, 'homePosts.js'));

// Úložiště prohlížeče v testu.
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

const NOW = Date.parse('2026-10-30T12:00:00Z');
const h = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();
const post = (id, owner, hoursAgo) => ({ id, owner_id: owner, created_at: h(hoursAgo) });

test('jen posledních 7 dní, nejnovější první', () => {
  const out = hp.pickShelfPosts([post('a', 'c1', 200), post('b', 'c2', 5), post('c', 'c3', 1)], { seen: new Set(), viewerId: null, now: NOW });
  assert.deepEqual(out.map((p) => p.id), ['c', 'b']);
});

test('otevřené ani vlastní příspěvky se neukážou', () => {
  const out = hp.pickShelfPosts([post('a', 'me', 1), post('b', 'c2', 2), post('c', 'c3', 3)], { seen: new Set(['b']), viewerId: 'me', now: NOW });
  assert.deepEqual(out.map((p) => p.id), ['c']);
});

test('nejvýš 2 od jednoho kanálu (upovídaný kanál řadu nezahltí)', () => {
  const posts = [post('1', 'spam', 1), post('2', 'spam', 2), post('3', 'spam', 3), post('4', 'spam', 4), post('5', 'other', 5)];
  const out = hp.pickShelfPosts(posts, { seen: new Set(), viewerId: null, now: NOW });
  assert.deepEqual(out.map((p) => p.id), ['1', '2', '5']);
});

test('nejvýš 12 v řadě, nesmyslné datum a budoucnost se přeskočí', () => {
  const posts = Array.from({ length: 30 }, (_, i) => post(`p${i}`, `c${i}`, i + 1));
  posts.push({ id: 'bad', owner_id: 'x', created_at: 'nesmysl' }, post('future', 'y', -48));
  const out = hp.pickShelfPosts(posts, { seen: new Set(), viewerId: null, now: NOW });
  assert.equal(out.length, 12);
  assert.ok(!out.some((p) => p.id === 'bad' || p.id === 'future'));
});

test('úryvek textu: bez zalomení, zkrácený se třemi tečkami', () => {
  assert.equal(hp.postExcerpt('ahoj\n\n  světe'), 'ahoj světe');
  const long = hp.postExcerpt('a'.repeat(300), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith('…'));
  assert.equal(hp.postExcerpt(null), '');
});

test('Skrýt schová řadu na týden, pak se vrátí', () => {
  assert.equal(hp.homePostsSnoozed(NOW), false);
  hp.snoozeHomePosts(NOW);
  assert.equal(hp.homePostsSnoozed(NOW + 6 * 24 * 3600 * 1000), true);
  assert.equal(hp.homePostsSnoozed(NOW + 8 * 24 * 3600 * 1000), false);
});

test('vypnutí v Nastavení; zapnutí zruší i Skrýt', () => {
  assert.equal(hp.homePostsEnabled(), true);
  hp.setHomePostsEnabled(false);
  assert.equal(hp.homePostsEnabled(), false);
  hp.snoozeHomePosts(Date.now());
  hp.setHomePostsEnabled(true);
  assert.equal(hp.homePostsEnabled(), true);
  assert.equal(hp.homePostsSnoozed(), false);
});

test('otevřené příspěvky se pamatují (nejvýš 300, bez opakování)', () => {
  for (let i = 0; i < 320; i++) hp.markPostSeen(`id${i}`);
  hp.markPostSeen('id319');
  const seen = hp.seenPostIds();
  assert.equal(seen.size, 300);
  assert.ok(seen.has('id319'));
  assert.ok(!seen.has('id0'));
});

test('poškozené úložiště nic nerozbije', () => {
  store.set(hp.HOME_POSTS_SEEN_KEY, '{nesmysl');
  assert.equal(hp.seenPostIds().size, 0);
  const broken = globalThis.window;
  globalThis.window = { localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} } };
  assert.equal(hp.homePostsEnabled(), true);
  hp.markPostSeen('x');
  globalThis.window = broken;
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
