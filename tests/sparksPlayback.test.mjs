/**
 * Test Sparks (lib/sparksPlayback.ts): které video napojit, které
 * přednačíst, náhled karty a co dělat, když prohlížeč nepustí přehrávání.
 *
 * Spustit:  node tests/sparksPlayback.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/sparksPlayback.ts');
const s = await import(join(kam, 'sparksPlayback.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const attached = (active, opts, count = 12) =>
  Array.from({ length: count }, (_, i) => i).filter((i) => s.sparkSlot(i, active, opts).attach);

test('než se rozjede první video, napojí se jen ono (přednačítání by mu bralo data)', () => {
  assert.deepEqual(attached(0, { engine: 'native', warm: false }), [0]);
  assert.deepEqual(attached(5, { engine: 'native', warm: false }), [5]);
});

test('pak jedno za sebou a dvě dopředu; při šetření dat (lehký režim) jen jedno dopředu a nic za sebou', () => {
  assert.deepEqual(attached(0, { engine: 'native', warm: true }), [0, 1, 2]);
  assert.deepEqual(attached(5, { engine: 'native', warm: true }), [4, 5, 6, 7]);
  assert.deepEqual(attached(5, { engine: 'native', warm: true, saveData: true }), [5, 6]);
  assert.deepEqual(attached(0, { engine: 'native', warm: true, saveData: true }), [0, 1]);
});

test('náhled karty v lehkém režimu menší (méně dat)', () => {
  assert.equal(
    s.sparkPoster({ thumbnail_url: 'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg' }, true),
    'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?height=480'
  );
  assert.equal(s.sparkPoster({ thumbnail_url: null, cloudflare_video_id: 'uid2' }, true), 'https://videodelivery.net/uid2/thumbnails/thumbnail.jpg?height=480');
});

test('iframe Cloudflare (záloha) je těžký - jen další jedno, jako dřív', () => {
  assert.deepEqual(attached(3, { engine: 'iframe', warm: true }), [3, 4]);
  assert.deepEqual(attached(3, { engine: 'iframe', warm: false }), [3]);
});

test('dokud se neví, čím hrát, nenapojí se nic - jen náhledy poblíž', () => {
  assert.deepEqual(attached(0, { engine: null, warm: true }), []);
  assert.equal(s.sparkSlot(2, 0, { engine: null, warm: false }).near, true);
});

test('lajky, komentáře a náhled jen u karet poblíž (ne u všech ~80 naráz)', () => {
  const near = Array.from({ length: 80 }, (_, i) => i).filter((i) => s.sparkSlot(i, 10, { engine: 'native', warm: true }).near);
  assert.deepEqual(near, [7, 8, 9, 10, 11, 12, 13]);
  // napojená karta je vždycky i "poblíž" (má prvek <video>)
  for (let i = 0; i < 20; i++) {
    const slot = s.sparkSlot(i, 10, { engine: 'native', warm: true });
    if (slot.attach) assert.equal(slot.near, true, `karta ${i}`);
  }
});

test('náhled karty: vlastní obrázek beze změny, náhled Cloudflare zmenšený, jinak podle id videa', () => {
  assert.equal(s.sparkPoster({ thumbnail_url: 'https://xyz.supabase.co/storage/v1/object/public/thumbnails/a.jpg' }), 'https://xyz.supabase.co/storage/v1/object/public/thumbnails/a.jpg');
  assert.equal(
    s.sparkPoster({ thumbnail_url: 'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg' }),
    'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?height=720'
  );
  assert.equal(
    s.sparkPoster({ thumbnail_url: 'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?time=2s' }),
    'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?time=2s&height=720'
  );
  assert.equal(
    s.sparkPoster({ thumbnail_url: 'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?height=360' }),
    'https://customer-abc.cloudflarestream.com/uid1/thumbnails/thumbnail.jpg?height=360'
  );
  assert.equal(s.sparkPoster({ thumbnail_url: null, cloudflare_video_id: 'uid2' }), 'https://videodelivery.net/uid2/thumbnails/thumbnail.jpg?height=720');
  assert.equal(s.sparkPoster({ thumbnail_url: 'javascript:alert(1)', cloudflare_video_id: null }), null);
  assert.equal(s.sparkPoster({}), null);
});

test('prohlížeč nepustil přehrávání: se zvukem -> potichu, potichu -> tlačítko, jiná chyba -> zkusit znovu', () => {
  assert.equal(s.afterPlayRejected('NotAllowedError', false), 'retry-muted');
  assert.equal(s.afterPlayRejected('NotAllowedError', true), 'needs-tap');
  assert.equal(s.afterPlayRejected('AbortError', false), 'ignore');
  assert.equal(s.afterPlayRejected(undefined, true), 'ignore');
});

test('přednačítá se jen kousek, video na řadě jako ostatní; za sebou celé (smyčka bez stahování)', () => {
  assert.ok(s.SPARK_PRELOAD_BUFFER_S > 0 && s.SPARK_PRELOAD_BUFFER_S <= 6);
  assert.ok(s.SPARK_ACTIVE_BUFFER_S >= 20);
  assert.ok(s.SPARK_BACK_BUFFER_S >= 120, 'Sparks mají až 2 minuty');
  assert.ok(s.SPARK_PLAY_RETRY_MS.every((ms, i, a) => i === 0 || ms > a[i - 1]), 'pokusy řídnou');
});

test('dvojité klepnutí = líbí se; nikdy nic nebere ani nepřepisuje hvězdičky', () => {
  assert.equal(s.doubleTapScore('like_dislike', null), 5);
  assert.equal(s.doubleTapScore('like_dislike', 1), 5, 'z nelíbí se na líbí se');
  assert.equal(s.doubleTapScore('like_dislike', 5), null, 'už se líbí - jen animace, lajk zůstane');
  assert.equal(s.doubleTapScore('stars', null), 5);
  assert.equal(s.doubleTapScore('stars', 2), null, 'vlastní hodnocení se nepřepisuje');
  assert.ok(s.SPARK_DOUBLE_TAP_MS >= 200 && s.SPARK_DOUBLE_TAP_MS <= 350);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
