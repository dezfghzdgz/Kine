/**
 * Test zdroje pro vlastní přehrávač hudby (lib/streamSource.ts).
 *
 * Spustit:  node tests/streamSource.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/streamSource.ts');
const {
  customerCodeFromUrl, manifestUrl, chooseEngineKind, companionCorrection,
  COMPANION_SEEK_DRIFT_S, COMPANION_NUDGE_DRIFT_S, STREAM_FALLBACK_HOST,
} = await import(join(kam, 'streamSource.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('kód zákazníka z adresy náhledu', () => {
  assert.equal(customerCodeFromUrl('https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e/thumbnails/thumbnail.jpg'), 'f33zs165nr7gyfy4');
  assert.equal(customerCodeFromUrl('https://xyz.supabase.co/storage/v1/object/public/thumbnails/a.jpg'), null);
  assert.equal(customerCodeFromUrl('https://videodelivery.net/6b9e/thumbnails/thumbnail.jpg'), null);
  assert.equal(customerCodeFromUrl(null), null);
  assert.equal(customerCodeFromUrl(''), null);
});

test('manifest: zákaznická doména, když je známá, jinak videodelivery.net', () => {
  assert.equal(manifestUrl('UID', 'abc123'), 'https://customer-abc123.cloudflarestream.com/UID/manifest/video.m3u8');
  assert.equal(manifestUrl('UID', null), `https://${STREAM_FALLBACK_HOST}/UID/manifest/video.m3u8`);
  // Podepsaný token sedí na místě id.
  assert.equal(manifestUrl('eyJ.token.sig', 'abc123'), 'https://customer-abc123.cloudflarestream.com/eyJ.token.sig/manifest/video.m3u8');
});

test('Safari (nativní HLS) -> audio, ostatní -> video', () => {
  assert.equal(chooseEngineKind(true), 'audio');
  assert.equal(chooseEngineKind(false), 'video');
});

test('společník: malý rozdíl nic, střední rychlostí, velký skokem', () => {
  assert.deepEqual(companionCorrection(10, 10.02), { seekTo: null, rate: 1 });
  assert.deepEqual(companionCorrection(10, 10 + COMPANION_NUDGE_DRIFT_S + 0.05), { seekTo: null, rate: 0.97 });
  assert.deepEqual(companionCorrection(10, 10 - COMPANION_NUDGE_DRIFT_S - 0.05), { seekTo: null, rate: 1.03 });
  assert.deepEqual(companionCorrection(10, 10 + COMPANION_SEEK_DRIFT_S + 0.1), { seekTo: 10, rate: 1 });
  assert.deepEqual(companionCorrection(10, 3), { seekTo: 10, rate: 1 });
});

test('společník: nesmyslné časy nespadnou', () => {
  assert.deepEqual(companionCorrection(NaN, 5), { seekTo: null, rate: 1 });
  assert.deepEqual(companionCorrection(5, Infinity), { seekTo: null, rate: 1 });
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
