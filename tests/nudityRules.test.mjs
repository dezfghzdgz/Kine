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

test('přenos: skrytí platí jen pro přenos, při kterém vzniklo (pozdější přenos začíná načisto)', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const start = Date.parse('2026-10-12T18:00:00Z');
  const hidden = start + 5 * 60_000;
  // skrytý během běžícího přenosu -> skrytý
  assert.equal(R.liveHiddenNow({ started_at: iso(start), moderation_hidden_at: iso(hidden) }), true);
  // skrytý v minulém přenosu, nový začal o hodinu později -> už ne (dřív zůstal kanál skrytý napořád)
  assert.equal(R.liveHiddenNow({ started_at: iso(hidden + 60 * 60_000), moderation_hidden_at: iso(hidden) }), false);
  // Ukončit + hned Vysílat (OBS jede dál) skrytí neobejde: přenos do půl hodiny po skrytí je skrytý taky
  assert.equal(R.liveHiddenNow({ started_at: iso(hidden + 20_000), moderation_hidden_at: iso(hidden) }), true);
  assert.equal(R.liveHiddenNow({ started_at: iso(hidden + R.LIVE_HIDE_CARRY_MS - 1000), moderation_hidden_at: iso(hidden) }), true);
  assert.equal(R.liveHiddenNow({ started_at: iso(hidden + R.LIVE_HIDE_CARRY_MS + 1000), moderation_hidden_at: iso(hidden) }), false);
  // bez skrytí / rozbitý čas -> ne; neznámý začátek -> radši skrytý
  assert.equal(R.liveHiddenNow({ started_at: iso(start), moderation_hidden_at: null }), false);
  assert.equal(R.liveHiddenNow({ started_at: iso(start), moderation_hidden_at: 'nesmysl' }), false);
  assert.equal(R.liveHiddenNow({ started_at: null, moderation_hidden_at: iso(start) }), true);
  assert.equal(R.liveHiddenNow(null), false);
  assert.equal(R.liveHiddenNow(undefined), false);
});

test('přenos: moderátor pouští / nechává jen skrytí, které teď platí (ne pozdější přenos ze staršího hlášení)', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const start = Date.parse('2026-10-12T18:00:00Z');
  const hidden = start + 5 * 60_000;
  const row = { started_at: iso(start), moderation_hidden_at: iso(hidden) };
  // hlášení vzniklo hned po skrytí -> týká se ho
  assert.equal(R.liveFlagIsCurrent(row, iso(hidden + 300)), true);
  // staré hlášení (dřívější skrytí) -> netýká se teď platného skrytí
  assert.equal(R.liveFlagIsCurrent(row, iso(hidden - 2 * 3600_000)), false);
  // nic teď skryté není (pozdější přenos, nebo bez skrytí) -> netýká se
  assert.equal(R.liveFlagIsCurrent({ started_at: iso(hidden + 2 * 3600_000), moderation_hidden_at: iso(hidden) }, iso(hidden + 300)), false);
  assert.equal(R.liveFlagIsCurrent({ started_at: iso(start), moderation_hidden_at: null }, iso(hidden)), false);
  assert.equal(R.liveFlagIsCurrent(null, iso(hidden)), false);
  // hlášení bez času (starší data) -> bere se, že se týká
  assert.equal(R.liveFlagIsCurrent(row, null), true);
});

test('přenos: podezřelé snímky z minulého přenosu se do nového nepočítají', () => {
  const start = 100_000_000;
  const old = [{ at: start - 60_000, level: 'severe' }, { at: start - 30_000, level: 'explicit' }];
  const fresh = [{ at: start + 10_000, level: 'suspect' }];
  const kept = R.liveStrikesSince([...old, ...fresh, null, { at: 'x', level: 'severe' }], new Date(start).toISOString());
  assert.deepEqual(kept, fresh);
  // jeden podezřelý snímek nového přenosu ho neskryje, i když minulý přenos skrytý byl
  assert.equal(R.liveShouldHide(R.addLiveStrike(kept, 'suspect', start + 20_000), start + 20_000), false);
  // bez začátku se nic nezahazuje
  assert.equal(R.liveStrikesSince(old, null).length, 2);
  assert.deepEqual(R.liveStrikesSince('nesmysl', null), []);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
