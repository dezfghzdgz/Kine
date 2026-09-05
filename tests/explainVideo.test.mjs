/**
 * Test popisku "proč tohle video" (lib/homeRecommendation.ts, explainVideo).
 * Popisek musí říkat pravdu o nejsilnější složce skóre - a mlčet, když
 * žádný důvod za zmínku nestojí.
 * Spustit:  node tests/explainVideo.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/homeRecommendation.ts');
const { explainVideo } = await import(join(kam, 'homeRecommendation.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-09-05T12:00:00Z');
const dny = (n) => new Date(NOW - n * 86400000).toISOString();
const ctx = { subscribedIds: new Set(['tvurce']), topCategories: new Set(['gaming']), topHashtags: new Set(['cs2', 'valorant']) };
const video = (o) => ({ id: 'v', owner_id: 'nekdo', category: 'music', hashtags: [], created_at: dny(30), views: 10, ...o });

test('odebíraný kanál má přednost před všemi ostatními důvody', () => {
  assert.equal(explainVideo(video({ owner_id: 'tvurce', category: 'gaming', hashtags: ['cs2'], created_at: dny(0), views: 99999 }), ctx, NOW), 'reasonSubscribed');
});

test('kategorie, kterou sleduješ, přebije hashtagy, když je silnější nebo stejná', () => {
  assert.equal(explainVideo(video({ category: 'gaming' }), ctx, NOW), 'reasonInterests');
  assert.equal(explainVideo(video({ category: 'gaming', hashtags: ['cs2', 'valorant', 'x'] }), ctx, NOW), 'reasonInterests', '20 >= 12');
});

test('tři a víc shodných hashtagů (18) přebijí kategorii (20)? ne - 18 < 20, takže kategorie', () => {
  assert.equal(explainVideo(video({ category: 'gaming', hashtags: ['cs2', 'valorant', 'cs2'] }), { ...ctx, topHashtags: new Set(['cs2', 'valorant']) }, NOW), 'reasonInterests');
});

test('jen hashtagy -> podle hashtagů', () => {
  assert.equal(explainVideo(video({ hashtags: ['cs2'] }), ctx, NOW), 'reasonHashtags');
});

test('čerstvé video (do 3 dnů) -> nové; starší ne', () => {
  assert.equal(explainVideo(video({ created_at: dny(1) }), ctx, NOW), 'reasonNew');
  assert.equal(explainVideo(video({ created_at: dny(3.5) }), ctx, NOW), null);
});

test('hodně zhlédnutí -> oblíbené; málo -> žádný popisek', () => {
  assert.equal(explainVideo(video({ views: 1000 }), ctx, NOW), 'reasonPopular');
  assert.equal(explainVideo(video({ views: 999 }), ctx, NOW), null);
});

test('rozbité datum nespadne a nehlásí "nové"', () => {
  assert.equal(explainVideo(video({ created_at: 'blbost' }), ctx, NOW), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
