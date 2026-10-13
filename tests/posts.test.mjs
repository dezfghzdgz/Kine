/**
 * Test příspěvků a anket (lib/posts.ts).
 *
 * Spustit:  node tests/posts.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/posts.ts');
const p = await import(join(kam, 'posts.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-10-13T12:00:00Z');

test('fotky: nové pole i starý jeden obrázek, jen https, bez opakování, nejvýš 4', () => {
  assert.deepEqual(p.postImages({ image_url: 'https://a.co/1.jpg' }), ['https://a.co/1.jpg']);
  assert.deepEqual(
    p.postImages({ image_urls: ['https://a.co/1.jpg', 'https://a.co/2.jpg', 'javascript:x', 'https://a.co/1.jpg'], image_url: 'https://a.co/1.jpg' }),
    ['https://a.co/1.jpg', 'https://a.co/2.jpg']
  );
  assert.equal(p.postImages({ image_urls: ['https://a/1', 'https://a/2', 'https://a/3', 'https://a/4', 'https://a/5'] }).length, 4);
  assert.deepEqual(p.postImages(null), []);
});

test('možnosti ankety: oříznuté, bez prázdných a opakování, 2-6', () => {
  assert.deepEqual(p.cleanPollOptions([' Ano ', '', 'ne', 'NE', 'Možná']), [{ text: 'Ano', votes: 0 }, { text: 'ne', votes: 0 }, { text: 'Možná', votes: 0 }]);
  assert.equal(p.cleanPollOptions(['jen jedna', ' ']), null);
  assert.equal(p.cleanPollOptions(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']).length, 6);
});

test('konec ankety: den, 3 dny, týden; 0 = bez konce', () => {
  assert.equal(p.pollEndsAt(24, NOW), '2026-10-14T12:00:00.000Z');
  assert.equal(p.pollEndsAt(0, NOW), null);
  assert.deepEqual([...p.POLL_DURATIONS_H], [24, 72, 168, 0]);
});

test('stav ankety: výsledky po hlasování / po konci / majiteli; po konci se nehlasuje; vítěz', () => {
  const options = [{ text: 'A', votes: 3 }, { text: 'B', votes: 5 }, { text: 'C', votes: 0 }];
  const running = p.pollState({ options, endsAt: '2026-10-14T12:00:00Z', voted: false, own: false, now: NOW });
  assert.deepEqual([running.total, running.ended, running.showResults, running.canVote, running.winner], [8, false, false, true, 1]);
  assert.equal(p.pollState({ options, endsAt: null, voted: true, own: false, now: NOW }).showResults, true);
  assert.equal(p.pollState({ options, endsAt: null, voted: false, own: true, now: NOW }).showResults, true);
  const ended = p.pollState({ options, endsAt: '2026-10-13T11:00:00Z', voted: false, own: false, now: NOW });
  assert.deepEqual([ended.ended, ended.canVote, ended.showResults], [true, false, true]);
  assert.equal(p.pollState({ options: [{ text: 'A' }, { text: 'B', votes: -2 }], endsAt: null, voted: false, own: false, now: NOW }).winner, null);
});

test('řazení na kanálu: připnuté nahoře (nejnověji připnutý první), pak od nejnovějšího', () => {
  const posts = [
    { id: 'a', created_at: '2026-10-10T00:00:00Z' },
    { id: 'b', created_at: '2026-10-12T00:00:00Z' },
    { id: 'c', created_at: '2026-10-01T00:00:00Z', pinned_at: '2026-10-05T00:00:00Z' },
    { id: 'd', created_at: '2026-09-01T00:00:00Z', pinned_at: '2026-10-11T00:00:00Z' },
  ];
  assert.deepEqual(p.sortPosts(posts).map((x) => x.id), ['d', 'c', 'b', 'a']);
});

test('video z odkazu: /watch/<id>, holé id; jinak null', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(p.videoIdFromLink(`https://www.playkine.com/watch/${id}?t=5`), id);
  assert.equal(p.videoIdFromLink(id.toUpperCase()), id);
  assert.equal(p.videoIdFromLink('https://youtube.com/watch?v=abc'), null);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
