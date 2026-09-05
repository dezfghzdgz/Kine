/**
 * Test pravidel pro uživatelské jméno (lib/username.ts) - hlavně filtru
 * nadávek. Dvě věci se hlídají stejně přísně: že nadávka neprojde ani
 * s číslicemi místo písmen, a že slušné jméno, které nadávku náhodou
 * obsahuje uvnitř (montenegro, spicy), projde.
 *
 * Stejné případy jede i databázová funkce username_is_valid - viz
 * supabase-migration-username-rules.sql a kontrola v PRECTI-ME.
 *
 * Spustit:  node tests/username.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/username.ts');
const { validateUsername, usernameContainsSlur } = await import(join(kam, 'username.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

// Sdílené případy - to samé se pouští proti databázi.
export const BLOKOVANA = [
  'nigger', 'NIGGER', 'n1gger', 'n1gg3r', 'nigga_king', 'xnigga', 'faggot.lol',
  'hitler1945', 'adolf_hitler', 'heilhitler', 'buzerant', 'negr', 'negr_123', 'n3gr',
  'spic', 'chink', 'coon', 'dyke', 'cunt', 'retard', 'nazi', 'nazi_boy', 'rape', 'rapist', '1488',
];

export const POVOLENA = [
  'montenegro', 'spicy_food', 'raccoon_fan', 'tycoon', 'scunthorpe', 'grape', 'drapery',
  'chinkiang', 'vandyke', 'retardant', 'coonhound', 'nazim', 'therapist', 'danielccerven58',
  'psicak', 'kine_fan', 'honza.novak', 'x_ae_a12', 'negrini', 'cigoska_lucie', 'kike_lopez',
];

test('nadávky neprojdou, ani s číslicemi místo písmen', () => {
  for (const j of BLOKOVANA) assert.equal(usernameContainsSlur(j), true, `mělo být blokované: ${j}`);
});

test('slušná jména, která nadávku obsahují jen uvnitř, projdou', () => {
  for (const j of POVOLENA) assert.equal(usernameContainsSlur(j), false, `nemělo být blokované: ${j}`);
});

test('validateUsername hlásí usernameBlocked až po ostatních pravidlech', () => {
  assert.equal(validateUsername('nigger'), 'usernameBlocked');
  assert.equal(validateUsername('ni'), 'usernameTooShort', 'krátké jméno hlásí délku, ne nadávku');
  assert.equal(validateUsername('admin'), 'usernameReserved');
  assert.equal(validateUsername('honza.novak'), null);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
if (padly) process.exit(1);
