/**
 * Test ověření formuláře oznámení o autorských právech (lib/copyrightNotice.ts).
 *
 * Spustit:  node tests/copyrightNotice.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/copyrightNotice.ts');
const { validateNotice, tidy, NOTICE_DESCRIPTION_MIN } = await import(join(kam, 'copyrightNotice.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const idOf = (url) => (url.includes('/watch/') ? 'some-id' : null);
const ok = {
  name: 'Jan Novák', email: 'jan@example.com', organization: '', videoUrl: 'https://kine-lac.vercel.app/watch/abc',
  description: 'Toto video obsahuje moji skladbu "Ráno" od 0:12 do 1:40 bez svolení.', goodFaith: true,
};

test('správně vyplněné oznámení projde', () => {
  assert.deepEqual(validateNotice(ok, idOf), []);
});

test('chybějící jméno, špatný e-mail, cizí adresa, krátký popis, bez prohlášení', () => {
  assert.deepEqual(validateNotice({ ...ok, name: 'J' }, idOf), ['name']);
  assert.deepEqual(validateNotice({ ...ok, email: 'jan@' }, idOf), ['email']);
  assert.deepEqual(validateNotice({ ...ok, videoUrl: 'https://youtube.com/watch?v=x' }, () => null), ['video']);
  assert.deepEqual(validateNotice({ ...ok, description: 'x'.repeat(NOTICE_DESCRIPTION_MIN - 1) }, idOf), ['description']);
  assert.deepEqual(validateNotice({ ...ok, goodFaith: false }, idOf), ['goodFaith']);
});

test('víc chyb naráz se vrátí všechny', () => {
  const problems = validateNotice({ name: '', email: '', videoUrl: '', description: '', goodFaith: false }, idOf);
  assert.deepEqual(problems.sort(), ['description', 'email', 'goodFaith', 'name', 'video']);
});

test('tidy: mezery, prázdno, strop', () => {
  assert.equal(tidy('  a   b\n\nc  ', 100), 'a b c');
  assert.equal(tidy('   ', 100), null);
  assert.equal(tidy(null, 100), null);
  assert.equal(tidy('x'.repeat(50), 10), 'x'.repeat(10));
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
