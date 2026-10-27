/**
 * Test pravidel pro uživatelské jméno (lib/username.ts): délka, povolené
 * znaky, rezervovaná jména a porovnávání bez velkých písmen. Filtr nadávek
 * ve jménech Kine nemá (rozhodnutí v říjnu 2026) - dřívější test na něj
 * padal; tenhle hlídá, co platí teď.
 *
 * Stejná pravidla hlídá databáze (supabase-migration-username-rules.sql).
 *
 * Spustit:  node tests/username.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/username.ts');
const { validateUsername, normalizeUsername, USERNAME_MIN, USERNAME_MAX } = await import(join(kam, 'username.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('běžná jména projdou (písmena, číslice, tečka, podtržítko)', () => {
  for (const ok of ['kine_fan', 'honza.novak', 'x_ae_a12', 'Psicak', 'abc', 'a'.repeat(USERNAME_MAX)]) {
    assert.equal(validateUsername(ok), null, ok);
  }
});

test('délka: moc krátké a moc dlouhé neprojde (mezery okolo se nepočítají)', () => {
  assert.equal(validateUsername('ab'), 'usernameTooShort');
  assert.equal(validateUsername('  ab  '), 'usernameTooShort');
  assert.equal(validateUsername('a'.repeat(USERNAME_MAX + 1)), 'usernameTooLong');
  assert.equal(USERNAME_MIN, 3);
});

test('znaky: jen základní latinka, bez znaménka na kraji a dvou za sebou', () => {
  for (const bad of ['jan novak', '.kine', 'kine_', 'jan..novak', 'jan._novak', 'kіne_fan', 'čeněk', 'emoji😀']) {
    assert.equal(validateUsername(bad), 'usernameBadCharacters', bad);
  }
});

test('rezervovaná jména (appka, podpora, adresy) si nikdo nevezme - ani velkými písmeny', () => {
  for (const bad of ['admin', 'Kine', 'SUPPORT', 'moderator', 'all', 'null']) {
    assert.equal(validateUsername(bad), 'usernameReserved', bad);
  }
});

test('porovnání bez velkých písmen a mezer okolo', () => {
  assert.equal(normalizeUsername('  Kine_Fan '), 'kine_fan');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
