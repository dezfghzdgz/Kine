/**
 * Test přepisu videa z titulků (lib/transcript.ts).
 *
 * Spustit:  node tests/transcript.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/transcript.ts');
const tr = await import(join(kam, 'transcript.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const CAPTIONS = [
  { time: 0, end: 2.5, text: 'Ahoj, vítejte u videa.' },
  { time: 3, end: 6, text: 'Dnes si ukážeme Příběh hry.' },
  { time: 6, text: 'Bez konce řádku.' },
  { time: 65, end: 70, text: 'Poslední věta.' },
];

test('čas řádku: m:ss, h:mm:ss, záporné a nesmysl = 0:00', () => {
  assert.equal(tr.formatCueTime(0), '0:00');
  assert.equal(tr.formatCueTime(65.9), '1:05');
  assert.equal(tr.formatCueTime(3723), '1:02:03');
  assert.equal(tr.formatCueTime(-4), '0:00');
  assert.equal(tr.formatCueTime(Number.NaN), '0:00');
});

test('právě mluvený řádek: před prvním nic, uvnitř řádku ten řádek, po konci ještě chvíli, pak nic', () => {
  assert.equal(tr.activeCaptionIndex(CAPTIONS, 1), 0);
  assert.equal(tr.activeCaptionIndex(CAPTIONS, 2.9), 0, 'krátká pauza po konci řádek nezhasne');
  assert.equal(tr.activeCaptionIndex(CAPTIONS, 4.5), 1);
  assert.equal(tr.activeCaptionIndex(CAPTIONS, 30), 2, 'řádek bez konce svítí, dokud nezačne další');
  assert.equal(tr.activeCaptionIndex(CAPTIONS, 66), 3);
  assert.equal(tr.activeCaptionIndex(CAPTIONS, 75), -1, 'dlouho po konci posledního řádku nic');
  assert.equal(tr.activeCaptionIndex([{ time: 5, text: 'x' }], 1), -1, 'před prvním řádkem nic');
  assert.equal(tr.activeCaptionIndex([], 10), -1);
});

test('hledání: bez diakritiky a velikosti písmen, původní pořadí a čísla řádků', () => {
  assert.deepEqual(tr.filterTranscript(CAPTIONS, 'pribeh').map((x) => x.index), [1]);
  assert.deepEqual(tr.filterTranscript(CAPTIONS, '  VĚTA ').map((x) => x.index), [3]);
  assert.deepEqual(tr.filterTranscript(CAPTIONS, 'e').map((x) => x.index), [0, 1, 2, 3]);
  assert.equal(tr.filterTranscript(CAPTIONS, '').length, CAPTIONS.length, 'prázdné hledání = celý přepis');
  assert.deepEqual(tr.filterTranscript(CAPTIONS, 'xyz'), []);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
