/**
 * Čerstvý účet (lib/newAccount.ts): do 24 h od založení, bez Plus, ne tým;
 * klipy mají pro čerstvý účet nižší denní strop (lib/clips.ts).
 *
 * Spustit:  node tests/newAccount.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/newAccount.ts', 'lib/plus.ts', 'lib/clips.ts');
const m = await import(join(kam, 'newAccount.js'));
const clips = await import(join(kam, 'clips.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try {
    fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

const now = Date.parse('2026-11-04T12:00:00Z');
const h = 3600 * 1000;
const iso = (msAgo) => new Date(now - msAgo).toISOString();

test('účet mladší než 24 h je čerstvý, starší ne', () => {
  assert.equal(m.isNewAccount(iso(2 * h), {}, {}, now), true);
  assert.equal(m.isNewAccount(iso(23.9 * h), {}, {}, now), true);
  assert.equal(m.isNewAccount(iso(24.1 * h), {}, {}, now), false);
  assert.equal(m.isNewAccount(iso(30 * 24 * h), { plan: 'free' }, {}, now), false);
});

test('bez data založení se bere jako starý účet', () => {
  assert.equal(m.isNewAccount(null, {}, {}, now), false);
  assert.equal(m.isNewAccount(undefined, null, {}, now), false);
  assert.equal(m.isNewAccount('nesmysl', {}, {}, now), false);
});

test('tým a Kine Plus čerství nejsou', () => {
  assert.equal(m.isNewAccount(iso(h), { is_admin: true }, {}, now), false);
  assert.equal(m.isNewAccount(iso(h), { role: 'moderator' }, {}, now), false);
  assert.equal(m.isNewAccount(iso(h), { role: 'admin' }, {}, now), false);
  assert.equal(m.isNewAccount(iso(h), { plan: 'plus', plan_until: iso(-30 * 24 * h) }, {}, now), false);
  // propadlé Plus nepomůže
  assert.equal(m.isNewAccount(iso(h), { plan: 'plus', plan_until: iso(24 * h) }, {}, now), true);
});

test('lhůta jde nastavit přes UPLOAD_NEW_ACCOUNT_HOURS, 0 = vypnuto', () => {
  assert.equal(m.newAccountHours({}), 24);
  assert.equal(m.newAccountHours({ UPLOAD_NEW_ACCOUNT_HOURS: '48' }), 48);
  assert.equal(m.newAccountHours({ UPLOAD_NEW_ACCOUNT_HOURS: '0' }), 0);
  assert.equal(m.newAccountHours({ UPLOAD_NEW_ACCOUNT_HOURS: 'abc' }), 0);
  assert.equal(m.isNewAccount(iso(30 * h), {}, { UPLOAD_NEW_ACCOUNT_HOURS: '48' }, now), true);
  assert.equal(m.isNewAccount(iso(h), {}, { UPLOAD_NEW_ACCOUNT_HOURS: '0' }, now), false);
});

test('klipy: čerstvý účet 5 za den, ostatní 30', () => {
  assert.equal(clips.clipsPerDayFor(true), clips.CLIPS_PER_DAY_NEW_ACCOUNT);
  assert.equal(clips.clipsPerDayFor(false), clips.CLIPS_PER_DAY);
  assert.ok(clips.CLIPS_PER_DAY_NEW_ACCOUNT < clips.CLIPS_PER_DAY);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
