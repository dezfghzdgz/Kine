/**
 * Test výběru do řádku "Pokračovat ve sledování" (lib/continueWatching.ts).
 *
 * Řádek je k ničemu, když nabízí dokoukaná videa nebo videa, na která
 * člověk jen klikl. Tady se hlídá přesně tahle hranice.
 *
 * Spustit:  node tests/continueWatching.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/continueWatching.ts');
const { pickContinueWatching, MAX_ITEMS, RESUME_REWIND_S } = await import(join(kam, 'continueWatching.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

function radek(id, progress, duration, extra = {}) {
  return {
    video_id: id,
    progress_seconds: progress,
    completed: false,
    watched_at: extra.watched_at ?? '2026-09-01T10:00:00Z',
    videos: extra.videos === null ? null : { id, title: id, duration_seconds: duration, status: 'ready', ...(extra.video ?? {}) },
  };
}

test('rozkoukané video se nabídne s procentem a s návazností o pár vteřin zpět', () => {
  const [v] = pickContinueWatching([radek('a', 300, 600)]);
  assert.equal(v.video.id, 'a');
  assert.equal(v.percent, 50);
  assert.equal(v.resumeAt, 300 - RESUME_REWIND_S);
});

test('dokoukané se nenabízí - podle příznaku i podle času', () => {
  assert.equal(pickContinueWatching([{ ...radek('a', 100, 600), completed: true }]).length, 0, 'příznak completed');
  assert.equal(pickContinueWatching([radek('b', 580, 600)]).length, 0, 'přes 95 %');
  assert.equal(pickContinueWatching([radek('c', 1000, 1015)]).length, 0, 'zbývá míň než 20 s');
});

test('sotva načaté video (pod 10 s) se nenabízí', () => {
  assert.equal(pickContinueWatching([radek('a', 4, 600)]).length, 0);
  assert.equal(pickContinueWatching([radek('b', 10, 600)]).length, 1, 'přesně 10 s už ano');
});

test('bez délky, bez videa nebo nehotové video se přeskočí', () => {
  assert.equal(pickContinueWatching([radek('a', 100, null)]).length, 0, 'bez délky');
  assert.equal(pickContinueWatching([radek('b', 100, 600, { videos: null })]).length, 0, 'video smazané');
  assert.equal(pickContinueWatching([radek('c', 100, 600, { video: { status: 'processing' } })]).length, 0, 'ještě se zpracovává');
});

test('nejnovější napřed, každé video jednou, nejvíc MAX_ITEMS', () => {
  const rows = [];
  for (let i = 0; i < MAX_ITEMS + 5; i++) {
    rows.push(radek('v' + i, 100, 600, { watched_at: `2026-09-0${1 + (i % 9)}T0${i % 10}:00:00Z` }));
  }
  rows.push(radek('v0', 200, 600, { watched_at: '2026-09-09T23:00:00Z' })); // to samé video znovu, nejnověji
  const out = pickContinueWatching(rows);
  assert.equal(out.length, MAX_ITEMS);
  assert.equal(out[0].video.id, 'v0', 'nejnovější zhlédnutí je první');
  assert.equal(out.filter((o) => o.video.id === 'v0').length, 1, 'video jen jednou');
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i - 1].watchedAt >= out[i].watchedAt, 'sestupně podle času');
  }
});

test('nesmyslné hodnoty nespadnou', () => {
  const out = pickContinueWatching([
    radek('a', null, 600),
    radek('b', 100, 600, { watched_at: null }),
    radek('c', 100, 600, { watched_at: 'blbost' }),
  ]);
  assert.equal(out.length, 2);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
