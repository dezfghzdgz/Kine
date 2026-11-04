/**
 * Pruh nahoře na Domovské (lib/homeBanner.ts): host / telefon / počítač,
 * zavření křížkem na pár dní.
 *
 * Spustit:  node tests/homeBanner.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/homeBanner.ts');
const m = await import(join(kam, 'homeBanner.js'));

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

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-04T12:00:00Z');
const base = { signedIn: false, guestDismissed: false, offerInstall: false, installDismissed: false, installed: false };

test('host vidí uvítání - i na telefonu (nejdřív účet, plocha až potom)', () => {
  assert.equal(m.pickHomeBanner(base), 'guest');
  assert.equal(m.pickHomeBanner({ ...base, offerInstall: true }), 'guest');
});

test('host, který uvítání zavřel: zpátky ke Kine do PC (na telefonu ho schová CSS)', () => {
  assert.equal(m.pickHomeBanner({ ...base, guestDismissed: true }), 'desktop');
});

test('přihlášený na telefonu: přidat na plochu; zavřené nebo nainstalované = nic navíc', () => {
  const signed = { ...base, signedIn: true, offerInstall: true };
  assert.equal(m.pickHomeBanner(signed), 'install');
  assert.equal(m.pickHomeBanner({ ...signed, installDismissed: true }), 'desktop');
  assert.equal(m.pickHomeBanner({ ...signed, installed: true }), 'desktop');
});

test('přihlášený na počítači: Kine do PC jako dřív', () => {
  assert.equal(m.pickHomeBanner({ ...base, signedIn: true }), 'desktop');
});

test('zavřeno křížkem: platí pár dní, pak se pruh vrátí', () => {
  assert.equal(m.dismissedRecently(String(NOW - 2 * DAY), NOW, 14), true);
  assert.equal(m.dismissedRecently(String(NOW - 13.9 * DAY), NOW, 14), true);
  assert.equal(m.dismissedRecently(String(NOW - 14 * DAY), NOW, 14), false);
  assert.equal(m.dismissedRecently(String(NOW - 40 * DAY), NOW, 30), false);
});

test('nesmysl v paměti prohlížeče = jako by nezavřel (ne „navždy schované“)', () => {
  assert.equal(m.dismissedRecently(null, NOW, 14), false);
  assert.equal(m.dismissedRecently('', NOW, 14), false);
  assert.equal(m.dismissedRecently('ano', NOW, 14), false);
  assert.equal(m.dismissedRecently('-5', NOW, 14), false);
  assert.equal(m.dismissedRecently(String(NOW + 10 * DAY), NOW, 14), false, 'čas z budoucnosti');
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
