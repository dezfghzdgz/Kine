/**
 * Test kvality videa podle připojení (lib/netQuality.ts): kdy šetřit data,
 * kdy se vrátit k plné kvalitě, adresa pro Safari a strop pro hls.js.
 *
 * Spustit:  node tests/netQuality.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/netQuality.ts');
const n = await import(join(kam, 'netQuality.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const NOW = Date.parse('2026-10-13T12:00:00Z');
const sample = (ms, stalls = 0, agoMin = 1, mode = 'full') => ({ at: NOW - agoMin * 60000, firstFrameMs: ms, stalls, mode });

test('prohlížeč: šetření dat a 2G/3G = pomalé, 4G s rychlostí = rychlé, jinak nevíme (iPhone)', () => {
  assert.equal(n.connectionSlow({ saveData: true, effectiveType: '4g', downlink: 20 }), true);
  assert.equal(n.connectionSlow({ effectiveType: '3g', downlink: 1.2 }), true);
  assert.equal(n.connectionSlow({ effectiveType: '4g', downlink: 0.8 }), true);
  assert.equal(n.connectionSlow({ effectiveType: '4g', downlink: 9 }), false);
  assert.equal(n.connectionSlow({ effectiveType: '4g' }), false);
  assert.equal(n.connectionSlow(null), null);
  assert.equal(n.connectionSlow({}), null);
});

test('změřené rozjezdy: pomalé (medián nad 3 s, nebo zasekávání), rychlé (dvakrát pod 1,2 s bez zaseknutí)', () => {
  assert.equal(n.measuredVerdict([sample(4000), sample(5200)], NOW), 'slow');
  assert.equal(n.measuredVerdict([sample(800, 2), sample(900, 1)], NOW), 'slow');
  assert.equal(n.measuredVerdict([sample(600), sample(900)], NOW), 'fast');
  assert.equal(n.measuredVerdict([sample(600), sample(1500)], NOW), null);
  assert.equal(n.measuredVerdict([sample(4000)], NOW), null, 'jeden pomalý rozjezd nestačí');
  assert.equal(n.measuredVerdict([], NOW), null);
});

test('staré rozjezdy (přes půl hodiny) se nepočítají - připojení se mění', () => {
  assert.equal(n.measuredVerdict([sample(6000, 0, 40), sample(6000, 0, 35)], NOW), null);
});

test('v lehkém režimu musí být rozjezd na návrat k plné kvalitě rychlejší (jinak by režim skákal)', () => {
  assert.equal(n.measuredVerdict([sample(900, 0, 2, 'light'), sample(1000, 0, 1, 'light')], NOW), null);
  assert.equal(n.measuredVerdict([sample(500, 0, 2, 'light'), sample(600, 0, 1, 'light')], NOW), 'fast');
});

test('režim: volba člověka vyhrává, pak prohlížeč, pak měření, jinak minulý', () => {
  assert.equal(n.decideMode('save', false, 'fast', 'full'), 'light');
  assert.equal(n.decideMode('best', true, 'slow', 'light'), 'full');
  assert.equal(n.decideMode('auto', true, 'fast', 'full'), 'light');
  assert.equal(n.decideMode('auto', null, 'slow', 'full'), 'light');
  assert.equal(n.decideMode('auto', null, 'fast', 'light'), 'full');
  assert.equal(n.decideMode('auto', null, null, 'light'), 'light');
  assert.equal(n.decideMode('auto', null, null, null), 'full');
  assert.equal(n.decideMode('auto', false, null, null), 'full');
});

test('Safari v lehkém režimu: adresa s clientBandwidthHint (jednou, jen u HLS manifestu)', () => {
  const url = 'https://customer-abc123.cloudflarestream.com/uid1/manifest/video.m3u8';
  assert.equal(n.lightManifestUrl(url), `${url}?clientBandwidthHint=${n.LIGHT_BANDWIDTH_HINT_MBPS}`);
  assert.equal(n.lightManifestUrl(`${url}?a=1`), `${url}?a=1&clientBandwidthHint=${n.LIGHT_BANDWIDTH_HINT_MBPS}`);
  assert.equal(n.lightManifestUrl(n.lightManifestUrl(url)), n.lightManifestUrl(url));
  assert.equal(n.lightManifestUrl('https://example.com/a.mp4'), 'https://example.com/a.mp4');
});

test('hls.js v lehkém režimu: strop = nejvyšší kvalita do 1,6 Mb/s', () => {
  const levels = [{ bitrate: 4_500_000 }, { bitrate: 800_000 }, { bitrate: 1_500_000 }, { bitrate: 300_000 }, { bitrate: 2_800_000 }];
  assert.equal(n.lightLevelCap(levels), 2);
  assert.equal(n.lightLevelCap([{ bitrate: 3_000_000 }]), -1, 'nic se nevejde = bez stropu');
  assert.equal(n.lightLevelCap([]), -1);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
