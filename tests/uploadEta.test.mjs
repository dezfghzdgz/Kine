/**
 * Test odhadu, kolik nahrávání ještě potrvá (lib/uploadEta.ts).
 *
 * Spustit:  node tests/uploadEta.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/uploadEta.ts');
const { uploadEtaSeconds, etaParts } = await import(join(kam, 'uploadEta.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('odhad z dosavadního tempa, ne hned na začátku', () => {
  // 25 % za 60 s -> zbývá 180 s
  assert.equal(uploadEtaSeconds(25, 60_000), 180);
  assert.equal(uploadEtaSeconds(50, 10_000), 10);
  // moc brzo / moc málo / hotovo -> nevíme
  assert.equal(uploadEtaSeconds(1, 60_000), null);
  assert.equal(uploadEtaSeconds(40, 2000), null);
  assert.equal(uploadEtaSeconds(100, 60_000), null);
  assert.equal(uploadEtaSeconds(NaN, 60_000), null);
});

test('čas po 5 s, minuty nahoru, hodiny s minutami', () => {
  assert.deepEqual(etaParts(3), { unit: 's', n: 5 });
  assert.deepEqual(etaParts(41), { unit: 's', n: 45 });
  assert.deepEqual(etaParts(61), { unit: 'min', n: 2 });
  assert.deepEqual(etaParts(59 * 60), { unit: 'min', n: 59 });
  assert.deepEqual(etaParts(3600), { unit: 'h', h: 1, m: 0 });
  assert.deepEqual(etaParts(2 * 3600 + 5 * 60 + 1), { unit: 'h', h: 2, m: 6 });
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
