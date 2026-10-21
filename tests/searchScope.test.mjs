/**
 * Test hledání v knihovně (lib/searchScope.ts): kde se hledá jen v sekci,
 * jak se hledá (diakritika, víc slov, tvůrce, hashtagy) a adresa s ?q=.
 *
 * Spustit:  node tests/searchScope.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/searchScope.ts');
const s = await import(join(kam, 'searchScope.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('v playlistu, lajkovaných a historii se hledá jen v nich (dřív vedlo hledání na celé Kine)', () => {
  assert.equal(s.searchScopeFor('/playlists/abc-123'), 'playlist');
  assert.equal(s.searchScopeFor('/liked'), 'liked');
  assert.equal(s.searchScopeFor('/history'), 'history');
  assert.equal(s.searchScopeFor('/watch-later'), 'watchLater');
  assert.equal(s.searchScopeFor('/playlists'), 'playlists');
  assert.equal(s.searchScopeFor('/subscriptions'), 'subscriptions');
  assert.equal(s.searchScopeFor('/your-videos'), 'yourVideos');
  assert.equal(s.searchScopeFor('/downloaded'), 'downloaded');
  assert.equal(s.searchScopeFor('/activity'), 'activity');
  assert.equal(s.searchScopeFor('/liked/'), 'liked');
});

test('jinde se hledá na celém Kine', () => {
  for (const p of ['/', '/search', '/watch/v1', '/channel/u1', '/playlists/a/b', '/explore', '', null]) {
    assert.equal(s.searchScopeFor(p), null, String(p));
  }
});

test('každá knihovna má vlastní text v poli', () => {
  for (const scope of ['playlist', 'liked', 'history', 'watchLater', 'playlists', 'subscriptions', 'yourVideos', 'downloaded', 'activity']) {
    assert.match(s.SCOPE_PLACEHOLDER[scope], /^searchIn[A-Z]/);
  }
});

test('hledání: bez velkých písmen a diakritiky, všechna slova, název i tvůrce i hashtagy', () => {
  const v = { title: 'Ďábelský Minecraft speedrun', profiles: { username: 'psicak', display_name: 'Psíčák' }, hashtags: ['cs2', 'Výhra'] };
  assert.equal(s.matchesSearch(v, 'dabel'), true);
  assert.equal(s.matchesSearch(v, 'MINECRAFT speed'), true);
  assert.equal(s.matchesSearch(v, 'minecraft roblox'), false, 'musí sedět všechna slova');
  assert.equal(s.matchesSearch(v, 'psicak'), true, 'jméno tvůrce');
  assert.equal(s.matchesSearch(v, '#vyhra'), true, 'hashtag');
  assert.equal(s.matchesSearch(v, '   '), true, 'prázdné = všechno');
  assert.equal(s.matchesSearch({ title: null }, 'a'), false, 'video bez názvu nespadne');
  assert.equal(s.matchesSearch({ title: 'Playlist', profiles: [{ username: 'eva' }] }, 'eva'), true, 'profil jako pole');
});

test('filtr seznamu a adresa s ?q= (ostatní parametry zůstanou)', () => {
  const list = [{ title: 'Kočka' }, { title: 'Pes' }, { title: 'kocour' }];
  assert.deepEqual(s.filterBySearch(list, 'koc').map((v) => v.title), ['Kočka', 'kocour']);
  assert.equal(s.filterBySearch(list, '').length, 3);
  assert.equal(s.withQuery('/liked', '', 'cs 2'), '/liked?q=cs+2');
  assert.equal(s.withQuery('/playlists/p1', '?q=old&x=1', ' new '), '/playlists/p1?q=new&x=1');
  assert.equal(s.withQuery('/history', '?q=old', ''), '/history');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
