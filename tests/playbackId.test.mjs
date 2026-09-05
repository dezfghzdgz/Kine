/**
 * Test rozhodování o adrese přehrávače (lib/playbackId.ts).
 *
 * Veřejné video hraje podle id, neveřejné podle tokenu - a když token není
 * nebo je prošlý, vrátí se id, ať se nic nerozbije.
 *
 * Spustit:  node tests/playbackId.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/playbackId.ts');
const { needsPlaybackToken, decidePlaybackId, cachedStillValid, TOKEN_SAFETY_MARGIN_MS } = await import(join(kam, 'playbackId.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const verejne = { id: 'v1', cloudflare_video_id: 'UID', visibility: 'public' };
const soukrome = { id: 'v2', cloudflare_video_id: 'UID2', visibility: 'private' };
const odberatele = { id: 'v3', cloudflare_video_id: 'UID3', visibility: 'subscribers' };

test('token potřebuje jen neveřejné video; neznámá viditelnost = veřejné', () => {
  assert.equal(needsPlaybackToken(verejne), false);
  assert.equal(needsPlaybackToken(soukrome), true);
  assert.equal(needsPlaybackToken(odberatele), true);
  assert.equal(needsPlaybackToken({ id: 'x', cloudflare_video_id: 'U' }), false);
  assert.equal(needsPlaybackToken({ id: 'x', cloudflare_video_id: 'U', visibility: null }), false);
});

test('platný token se použije místo id', () => {
  const now = 1_000_000;
  const d = decidePlaybackId(soukrome, { token: 'TOKEN', expiresAt: now + 4 * 3600 * 1000 }, now);
  assert.equal(d.id, 'TOKEN');
  assert.equal(d.expiresAt, now + 4 * 3600 * 1000);
});

test('bez tokenu (ochrana nenastavená, nebo bez práva) zůstává id', () => {
  assert.equal(decidePlaybackId(soukrome, null).id, 'UID2');
  assert.equal(decidePlaybackId(soukrome, { token: null }).id, 'UID2');
  assert.equal(decidePlaybackId(soukrome, {}).id, 'UID2');
});

test('token, který za chvíli vyprší, se nepoužije', () => {
  const now = 1_000_000;
  const d = decidePlaybackId(soukrome, { token: 'TOKEN', expiresAt: now + TOKEN_SAFETY_MARGIN_MS - 1 }, now);
  assert.equal(d.id, 'UID2');
});

test('token bez expiresAt dostane hodinu', () => {
  const now = 1_000_000;
  const d = decidePlaybackId(soukrome, { token: 'TOKEN' }, now);
  assert.equal(d.id, 'TOKEN');
  assert.equal(d.expiresAt, now + 3600 * 1000);
});

test('zapamatovaný token platí do rezervy před vypršením', () => {
  const now = 1_000_000;
  assert.equal(cachedStillValid({ id: 'T', expiresAt: now + TOKEN_SAFETY_MARGIN_MS + 1 }, now), true);
  assert.equal(cachedStillValid({ id: 'T', expiresAt: now + TOKEN_SAFETY_MARGIN_MS }, now), false);
  assert.equal(cachedStillValid(undefined, now), false);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
