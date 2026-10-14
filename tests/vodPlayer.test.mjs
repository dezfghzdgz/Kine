/**
 * Test vlastního přehrávače videí (lib/vodPlayerCore.ts): s jakou kvalitou
 * začít, nabídka kvality, statistiky načtených kusů a proč se video
 * načítá pomalu.
 *
 * Spustit:  node tests/vodPlayer.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/vodPlayerCore.ts');
const v = await import(join(kam, 'vodPlayerCore.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('začíná se malým kusem: bez paměti ~360p, s pamětí nejvýš ~720p', () => {
  assert.equal(v.startEstimate(null), v.DEFAULT_START_BPS);
  assert.equal(v.startEstimate(0), v.DEFAULT_START_BPS);
  assert.equal(v.startEstimate(NaN), v.DEFAULT_START_BPS);
  // rychlé připojení (50 Mb/s): i tak jen do stropu - první kus musí být malý
  assert.equal(v.startEstimate(50_000_000), v.MAX_START_BPS);
  // pomalé (1 Mb/s): 60 % odhadu, ale ne pod nejnižší kvalitu
  assert.equal(v.startEstimate(1_000_000), 600_000);
  assert.equal(v.startEstimate(100_000), 300_000);
  // Cloudflare 360p ~0,8 Mb/s se vejde, 720p (~2,5 Mb/s a víc) bez paměti ne
  assert.ok(v.DEFAULT_START_BPS * 0.95 > 800_000 && v.DEFAULT_START_BPS * 0.95 < 2_500_000);
});

test('počítač s dobrým připojením začíná rovnou v plné kvalitě, telefon dál s malým kusem', () => {
  // počítač bez paměti a bez údaje od prohlížeče: ~1080p (Cloudflare 1080p ~4-5 Mb/s se vejde)
  assert.equal(v.startEstimateFor({ remembered: null, device: 'desktop' }), v.DESKTOP_DEFAULT_START_BPS);
  assert.ok(v.DESKTOP_DEFAULT_START_BPS * 0.95 > 4_000_000);
  // počítač s rychlou wifi (zapamatováno 40 Mb/s): vysoko, se stropem
  assert.equal(v.startEstimateFor({ remembered: 40_000_000, device: 'desktop' }), 15_000_000);
  // počítač se špatnou wifi (zapamatováno 1,5 Mb/s): nízko - jako dřív
  assert.equal(v.startEstimateFor({ remembered: 1_500_000, device: 'desktop' }), 1_200_000);
  // prohlížeč řekl rychlost (Chrome: nejvýš 10 Mb/s)
  assert.equal(v.startEstimateFor({ remembered: null, device: 'desktop', downlinkMbps: 10 }), 8_000_000);
  assert.equal(v.startEstimateFor({ remembered: null, device: 'tv', downlinkMbps: 2 }), 1_600_000);
  // telefon a tablet beze změny (malý první kus, i na rychlé wifi)
  assert.equal(v.startEstimateFor({ remembered: null, device: 'phone', downlinkMbps: 10 }), v.DEFAULT_START_BPS);
  assert.equal(v.startEstimateFor({ remembered: 50_000_000, device: 'tablet' }), v.MAX_START_BPS);
  // náhled po najetí myší na počítači: dál malý
  assert.equal(v.startEstimateFor({ remembered: 40_000_000, device: 'desktop', small: true }), v.MAX_START_BPS);
});

test('vlastní přehrávač, kde to jde; jinak (nebo na přání) Cloudflare', () => {
  assert.equal(v.chooseEngine({ nativeHls: false, mse: true, forceCloudflare: false }), 'native');
  assert.equal(v.chooseEngine({ nativeHls: true, mse: false, forceCloudflare: false }), 'native');
  assert.equal(v.chooseEngine({ nativeHls: false, mse: false, forceCloudflare: false }), 'iframe');
  assert.equal(v.chooseEngine({ nativeHls: true, mse: true, forceCloudflare: true }), 'iframe');
});

test('nabídka kvality: od nejvyšší, každá výška jednou', () => {
  const levels = [
    { height: 360, bitrate: 800_000 },
    { height: 1080, bitrate: 5_000_000 },
    { height: 720, bitrate: 2_500_000 },
    { height: 720, bitrate: 3_200_000 }, // dvě 720p (třeba 30 a 60 fps) - nabídne se ta lepší
    { height: 0, bitrate: 64_000 }, // jen zvuk
    null,
  ];
  assert.deepEqual(v.qualityOptions(levels), [
    { index: 1, height: 1080, bitrateKbps: 5000 },
    { index: 3, height: 720, bitrateKbps: 3200 },
    { index: 0, height: 360, bitrateKbps: 800 },
  ]);
  assert.deepEqual(v.qualityOptions([]), []);
  assert.equal(v.qualityLabel(1080), '1080p');
  assert.equal(v.qualityLabel(null), '?');
});

test('statistiky kusu z hls.js: první bajt, načtení, velikost, rychlost', () => {
  const s = v.fragmentSample({ loading: { start: 1000, first: 1180, end: 1830 }, loaded: 1_048_576 }, 360, 4);
  assert.deepEqual(s, { height: 360, ttfbMs: 180, loadMs: 830, kb: 1024, seconds: 4 });
  // 1 MiB za 650 ms přenosu = ~12,9 Mb/s
  assert.equal(v.fragmentKbps(s), Math.round((1024 * 1024 * 8) / 650));
  // nesmysly -> nic
  assert.equal(v.fragmentSample({ loading: { start: 5, end: 2 } }, 360, 4), null);
  assert.equal(v.fragmentSample(null, 360, 4), null);
  // chybí "first": bere se celé načtení
  assert.equal(v.fragmentSample({ loading: { start: 0, end: 400 }, total: 2048 }, 720, 6).ttfbMs, 400);
  assert.equal(v.fragmentKbps({ height: 1, ttfbMs: 0, loadMs: 0, kb: 0, seconds: 1 }), null);
});

test('proč pomalé: Cloudflare (pozdní první bajt / seznam), nebo připojení', () => {
  const fast = { height: 360, ttfbMs: 120, loadMs: 600, kb: 900, seconds: 4 };
  assert.equal(v.vodVerdict({ manifestMs: 150, firstFragment: null, bandwidthKbps: null }), 'waiting');
  assert.equal(v.vodVerdict({ manifestMs: 150, firstFragment: fast, bandwidthKbps: 25_000 }), 'ok');
  assert.equal(v.vodVerdict({ manifestMs: 150, firstFragment: { ...fast, ttfbMs: 4200, loadMs: 4700 }, bandwidthKbps: 25_000 }), 'slow-server');
  assert.equal(v.vodVerdict({ manifestMs: 6000, firstFragment: null, bandwidthKbps: null }), 'slow-server');
  assert.equal(v.vodVerdict({ manifestMs: 150, firstFragment: fast, bandwidthKbps: 1_800 }), 'slow-connection');
  // bez odhadu z hls.js se počítá z kusu: 900 KB za 4,5 s = ~1,6 Mb/s
  assert.equal(v.vodVerdict({ manifestMs: 150, firstFragment: { ...fast, loadMs: 4620 }, bandwidthKbps: null }), 'slow-connection');
  assert.equal(v.mbps(12_345), '12.3');
  assert.equal(v.mbps(null), '?');
});

test('hlášení pomalého videa: dlouhý rozjezd, zasekávání, ne při čekání na klepnutí', () => {
  assert.equal(v.shouldReportSlowStart({ firstFrameMs: 2100, waitedMs: 30_000, stalls: 0, waitingForTap: false }), false);
  assert.equal(v.shouldReportSlowStart({ firstFrameMs: 9000, waitedMs: 9000, stalls: 0, waitingForTap: false }), true);
  assert.equal(v.shouldReportSlowStart({ firstFrameMs: 1500, waitedMs: 60_000, stalls: 3, waitingForTap: false }), true);
  // pořád se nerozjelo
  assert.equal(v.shouldReportSlowStart({ firstFrameMs: null, waitedMs: 8000, stalls: 0, waitingForTap: false }), false);
  assert.equal(v.shouldReportSlowStart({ firstFrameMs: null, waitedMs: 16_000, stalls: 0, waitingForTap: false }), true);
  // prohlížeč čeká na klepnutí (bez zvuku nesmí hrát sám) - to není pomalé video
  assert.equal(v.shouldReportSlowStart({ firstFrameMs: null, waitedMs: 60_000, stalls: 0, waitingForTap: true }), false);
});

test('technický souhrn: všechno podstatné na pár řádcích', () => {
  const text = v.statsReport(
    {
      engine: 'hls.js',
      host: 'customer-abc.cloudflarestream.com',
      manifestMs: 210,
      firstFrameMs: 9800,
      firstFragment: { height: 360, ttfbMs: 7400, loadMs: 7900, kb: 600, seconds: 4 },
      recent: [{ height: 720, ttfbMs: 300, loadMs: 900, kb: 1800, seconds: 4 }],
      height: 720,
      bitrateKbps: 2800,
      bandwidthKbps: 21_000,
      stalls: 1,
      retries: 2,
      lastError: 'fragLoadTimeOut',
    },
    { videoId: 'v1', durationS: 720.4, startAt: 300, bufferedAheadS: 12.5, waitedMs: 12_000 }
  );
  assert.match(text, /verdict=slow-server engine=hls\.js mode=full host=customer-abc\.cloudflarestream\.com/);
  assert.match(text, /video=v1 duration=720s startAt=300s/);
  assert.match(text, /firstFrame=9800ms manifest=210ms/);
  assert.match(text, /firstChunk=360p 4s ttfb=7400ms load=7900ms 600KB/);
  assert.match(text, /stalls=1 retries=2 lastError=fragLoadTimeOut/);
  assert.match(text, /chunk1: 720p/);
  assert.match(text, /buffer=12\.5s/);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
