/**
 * Test hlídání zamrzlého obrazu u živého vysílání (lib/livePlayback.ts).
 *
 * Spustit:  node tests/livePlayback.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/livePlayback.ts');
const lp = await import(join(kam, 'livePlayback.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const T = 1_000_000_000;
const base = { now: T, lastProgressAt: T, lastReloadAt: 0, reloads: 0, pausedByViewer: false, visible: true };

test('obraz běží nebo stojí krátce: nic', () => {
  assert.equal(lp.stallAction(base), 'none');
  assert.equal(lp.stallAction({ ...base, now: T + lp.LIVE_STALL_MS - 1 }), 'none');
});

test('obraz stojí 20 s: první obnova hned, další s rostoucím odstupem', () => {
  const stuck = { ...base, now: T + lp.LIVE_STALL_MS };
  assert.equal(lp.stallAction(stuck), 'reload');
  // po první obnově (reloads 1): až 30 s od ní
  const after1 = { ...base, lastProgressAt: T, lastReloadAt: T + 5000, reloads: 1 };
  assert.equal(lp.stallAction({ ...after1, now: T + 30000 }), 'none');
  assert.equal(lp.stallAction({ ...after1, now: T + 35000 }), 'reload');
  // hodně pokusů: odstup zůstane na posledním (2 min)
  const many = { ...base, lastReloadAt: T, reloads: 9 };
  assert.equal(lp.stallAction({ ...many, now: T + 119000 }), 'none');
  assert.equal(lp.stallAction({ ...many, now: T + 120000 }), 'reload');
});

test('pauza od diváka nebo karta na pozadí: žádná obnova', () => {
  const stuck = { ...base, now: T + 60000 };
  assert.equal(lp.stallAction({ ...stuck, pausedByViewer: true }), 'none');
  assert.equal(lp.stallAction({ ...stuck, visible: false }), 'none');
});

test('adresa po obnově je jiná (iframe se opravdu načte znovu)', () => {
  const url = 'https://customer-abc.cloudflarestream.com/in1/iframe?autoplay=true';
  assert.equal(lp.livePlayerSrc(url, 0), url);
  assert.equal(lp.livePlayerSrc(url, 2), `${url}&kr=2`);
  assert.equal(lp.livePlayerSrc('https://x.test/iframe', 1), 'https://x.test/iframe?kr=1');
});

test('adresa přehrávače ze serveru: nahoru na vstup ano, zpátky na náhradní ne', () => {
  const input = 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe?autoplay=true&letterboxColor=transparent';
  const fallbackA = 'https://iframe.videodelivery.net/aaaa1111?autoplay=true';
  const fallbackB = 'https://iframe.videodelivery.net/bbbb2222?autoplay=true';
  // první adresa a stejná adresa
  assert.equal(lp.nextPlayerUrl(null, fallbackA), fallbackA);
  assert.equal(lp.nextPlayerUrl(input, input), input);
  // náhradní -> vstup (lepší), náhradní -> jiné video (nový přenos)
  assert.equal(lp.nextPlayerUrl(fallbackA, input), input);
  assert.equal(lp.nextPlayerUrl(fallbackA, fallbackB), fallbackB);
  // vstup -> náhradní: zůstane vstup (iframe se zbytečně nenačítá znovu)
  assert.equal(lp.nextPlayerUrl(input, fallbackA), input);
  // nic nového: zůstane, co je
  assert.equal(lp.nextPlayerUrl(input, null), input);
  assert.equal(lp.nextPlayerUrl(null, null), null);
});

test('postup času: jen dopředu, skok zpět ani první údaj není postup', () => {
  assert.equal(lp.timeAdvanced(null, 5), false);
  assert.equal(lp.timeAdvanced(5, 5), false);
  assert.equal(lp.timeAdvanced(5, 5.5), true);
  assert.equal(lp.timeAdvanced(50, 2), false);
  assert.equal(lp.timeAdvanced(5, Number.NaN), false);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
