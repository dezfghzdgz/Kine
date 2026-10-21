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

test('výchozí je plná kvalita: jedno pomalé video ani jedno zaseknutí lehký režim nezapnou', () => {
  assert.equal(n.measuredVerdict([], NOW), null);
  assert.equal(n.measuredVerdict([sample(4000)], NOW), null, 'pomalejší rozjezd (4 s) není slabý signál');
  assert.equal(n.measuredVerdict([sample(4000), sample(4500)], NOW), null, 'ani dvakrát 4 s (Safari na datech začíná vysoko)');
  assert.equal(n.measuredVerdict([sample(900, 1)], NOW), null, 'jedno zaseknutí nestačí');
  assert.equal(n.decideMode('auto', null, null, null), 'full');
});

test('slabý signál: plná kvalita se zasekávala (2×), nebo se dvakrát po sobě rozjížděla přes 5 s', () => {
  assert.equal(n.measuredVerdict([sample(800, 2)], NOW), 'slow');
  assert.equal(n.measuredVerdict([sample(6000), sample(7000)], NOW), 'slow');
  assert.equal(n.measuredVerdict([sample(6000), sample(900), sample(7000)], NOW), null, 'mezi nimi rychlé video - nejde říct');
  assert.equal(n.measuredVerdict([sample(900, 0, 2, 'light'), sample(1000, 1, 1, 'light')], NOW), 'slow', 'zasekává se i lehká kvalita');
});

test('dobrý signál: video se rozjelo do 3 s bez zaseknutí (i v lehkém režimu - návrat k plné kvalitě)', () => {
  assert.equal(n.measuredVerdict([sample(2500)], NOW), 'fast');
  assert.equal(n.measuredVerdict([sample(1800, 0, 1, 'light')], NOW), 'fast', 'dřív na iPhonu muselo být pod 0,7 s - skoro nikdy');
  assert.equal(n.measuredVerdict([sample(3500)], NOW), null);
});

test('lehký režim po potížích drží 10 minut (žádné přeskakování u každého videa), pak zase plná kvalita', () => {
  const troubled = [sample(900, 3, 6), sample(800, 0, 4, 'light'), sample(700, 0, 2, 'light')];
  assert.equal(n.measuredVerdict(troubled, NOW), 'slow', 'zaseknutá plná kvalita před 6 min se pořád počítá');
  const later = [sample(900, 3, 12), sample(800, 0, 4, 'light'), sample(700, 0, 2, 'light')];
  assert.equal(n.measuredVerdict(later, NOW), 'fast', 'po 10 minutách se potíž zapomene');
});

test('staré rozjezdy (přes 10 minut) se nepočítají - připojení se mění', () => {
  assert.equal(n.measuredVerdict([sample(6000, 0, 15), sample(6000, 0, 12)], NOW), null);
  assert.equal(n.measuredVerdict([sample(800, 4, 11)], NOW), null);
});

test('zapamatovaný režim platí jen 10 minut; staré uložení bez času se nepočítá', () => {
  assert.equal(n.freshMode(JSON.stringify({ mode: 'light', at: NOW - 3 * 60000 }), NOW), 'light');
  assert.equal(n.freshMode(JSON.stringify({ mode: 'light', at: NOW - 11 * 60000 }), NOW), null);
  assert.equal(n.freshMode('light', NOW), null, 'dřívější uložení "light" by jinak drželo lehký režim navždy');
  assert.equal(n.freshMode(null, NOW), null);
  assert.equal(n.freshMode('{nonsense', NOW), null);
});

test('lehký režim se opakováním neobnovuje - bez nového důvodu vyprší po 10 minutách', () => {
  const prev = { mode: 'light', at: NOW - 8 * 60000 };
  assert.deepEqual(n.nextModeRecord(prev, 'light', false, NOW), prev, 'jen zopakovaný režim: čas zůstane starý');
  assert.deepEqual(n.nextModeRecord(prev, 'light', true, NOW), { mode: 'light', at: NOW }, 'nové měření potíží: čas se obnoví');
  assert.deepEqual(n.nextModeRecord(prev, 'full', false, NOW), { mode: 'full', at: NOW }, 'změna režimu se zapíše');
  assert.deepEqual(n.nextModeRecord({ mode: 'light', at: NOW - 11 * 60000 }, 'light', false, NOW), { mode: 'light', at: NOW }, 'prošlý záznam se nedrží');
  assert.deepEqual(n.nextModeRecord(null, 'full', false, NOW), { mode: 'full', at: NOW });
});

test('režim: volba člověka vyhrává, pak prohlížeč, pak měření, jinak čerstvý minulý, jinak plná', () => {
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
