/**
 * Test pravidel automatické kontroly nahoty (lib/nudityRules.ts):
 * kdy se video skryje, kdy jde jen ke kontrole, výjimka pro umění,
 * časy snímků a sčítání snímků z přenosu.
 *
 * Spustit:  node tests/nudityRules.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/nudityRules.ts');
const R = await import(join(kam, 'nudityRules.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const frame = (o) => ({ porn: 0, hentai: 0, sexy: 0, neutral: 1, drawing: 0, ...o });
const clean = frame({});

test('běžné video (samé neutrální snímky) projde', () => {
  assert.deepEqual(R.nudityVerdict([clean, clean, clean, clean]), { action: 'ok', reason: null, worst: 0 });
  assert.equal(R.nudityVerdict([]).action, 'ok', 'bez snímků se nic nerozhoduje');
});

test('porno: jeden velmi jistý snímek video skryje - i když autor tvrdí, že je to umění', () => {
  const v = R.nudityVerdict([clean, frame({ porn: 0.9 }), clean], { artistic: true });
  assert.equal(v.action, 'hold');
  assert.equal(v.reason, 'porn');
  assert.equal(R.nudityVerdict([frame({ hentai: 0.5, porn: 0.4 })]).action, 'hold', 'hentai + porn se sčítá');
});

test('porno: dva středně jisté snímky skryjí, jeden jen pošle ke kontrole', () => {
  assert.equal(R.nudityVerdict([frame({ porn: 0.65 }), frame({ porn: 0.7 }), clean]).action, 'hold');
  const one = R.nudityVerdict([frame({ porn: 0.65 }), clean, clean]);
  assert.equal(one.action, 'review');
  assert.equal(one.reason, 'porn');
});

test('nahota: opakovaně velmi jistá -> skrýt; u umění jen ke kontrole', () => {
  const nude = [frame({ sexy: 0.95 }), frame({ sexy: 0.97 }), clean];
  assert.deepEqual(R.nudityVerdict(nude), { action: 'hold', reason: 'nudity', worst: 0.97 });
  assert.equal(R.nudityVerdict(nude, { artistic: true }).action, 'review');
});

test('nahota: jeden snímek (plavky, zápas) video neskryje, jen ho ukáže moderátorovi', () => {
  assert.equal(R.nudityVerdict([frame({ sexy: 0.96 }), clean, clean]).action, 'review');
  assert.equal(R.nudityVerdict([frame({ sexy: 0.7 }), clean]).action, 'ok', 'slabý signál nic');
});

test('výsledek modelu -> čísla snímku (neznámé třídy a rozbitá čísla = 0)', () => {
  const f = R.framesFromPredictions([
    { className: 'Neutral', probability: 0.7 },
    { className: 'Porn', probability: 0.2 },
    { className: 'Sexy', probability: 1.4 },
    { className: 'Hentai', probability: NaN },
  ]);
  assert.deepEqual(f, { porn: 0.2, hentai: 0, sexy: 1, neutral: 0.7, drawing: 0 });
});

test('časy snímků: rovnoměrně 5-95 %, víc u delšího videa (nejvýš 6), krátké video aspoň dva', () => {
  assert.deepEqual(R.scanTimes(0), [0]);
  assert.deepEqual(R.scanTimes(4), [0, 2]);
  const minute = R.scanTimes(60);
  assert.equal(minute.length, 5);
  assert.equal(minute[0], 3);
  assert.equal(minute[minute.length - 1], 57);
  assert.equal(R.scanTimes(3600).length, 6, 'nejvýš 6 snímků');
  assert.ok(R.scanTimes(3600).every((t) => t >= 180 && t <= 3420));
  assert.deepEqual(R.scanTimes(NaN), [0]);
});

test('přenos: úrovně snímků', () => {
  assert.equal(R.liveSnapshotLevel(clean), 'ok');
  assert.equal(R.liveSnapshotLevel(frame({ porn: 0.97 })), 'severe');
  assert.equal(R.liveSnapshotLevel(frame({ porn: 0.88 })), 'explicit');
  assert.equal(R.liveSnapshotLevel(frame({ sexy: 0.96 })), 'explicit');
  assert.equal(R.liveSnapshotLevel(frame({ sexy: 0.87 })), 'suspect');
  assert.equal(R.liveSnapshotLevel(frame({ porn: 0.62 })), 'suspect');
});

test('přenos: skryje se po jednom velmi jistém, dvou jasných nebo třech podezřelých snímcích za 10 min', () => {
  const now = 10_000_000;
  let s = R.addLiveStrike([], 'explicit', now - 60_000);
  assert.equal(R.liveShouldHide(s, now), false, 'jeden jasný snímek ještě ne');
  s = R.addLiveStrike(s, 'explicit', now);
  assert.equal(R.liveShouldHide(s, now), true);
  assert.equal(R.liveShouldHide(R.addLiveStrike([], 'severe', now), now), true);
  let sus = R.addLiveStrike([], 'suspect', now - 120_000);
  sus = R.addLiveStrike(sus, 'suspect', now - 60_000);
  assert.equal(R.liveShouldHide(sus, now), false);
  sus = R.addLiveStrike(sus, 'suspect', now);
  assert.equal(R.liveShouldHide(sus, now), true);
});

test('přenos: staré snímky (víc než 10 min) a rozbitá data se zahodí, čistý snímek nic nepřidá', () => {
  const now = 50_000_000;
  const s = R.addLiveStrike([{ at: now - 11 * 60_000, level: 'explicit' }, { at: 'x', level: 'severe' }, null, { at: now - 1000, level: 'nesmysl' }], 'explicit', now);
  assert.deepEqual(s, [{ at: now, level: 'explicit' }]);
  assert.equal(R.liveShouldHide(s, now), false);
  assert.deepEqual(R.addLiveStrike(s, 'ok', now + 1), s);
  assert.equal(R.addLiveStrike(Array.from({ length: 30 }, (_, i) => ({ at: now - i, level: 'suspect' })), 'suspect', now).length, 10);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
