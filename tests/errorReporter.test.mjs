/**
 * Test hlášení chyb (lib/errorReporter.ts) - to, co by bez testu zlobilo
 * nejvíc: zahlcení stejnou chybou, šum z rozšíření, adresa s parametry
 * a otisk, který má přežít nové nasazení.
 *
 * Spustit:  node tests/errorReporter.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/errorReporter.ts', 'lib/deviceClass.ts');
// Přeložený soubor importuje './deviceClass' bez přípony - Node ji chce.
const cesta = join(kam, 'errorReporter.js');
writeFileSync(cesta, readFileSync(cesta, 'utf8').replace("'./deviceClass'", "'./deviceClass.js'"));
const { prepareReport, createState, fingerprintOf, stripUrl, describeThrown, MAX_PER_PAGE } = await import(cesta);

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const CTX = { url: 'https://kine-lac.vercel.app/search?q=tajne+heslo#x', userAgent: 'UA', device: 'phone' };

test('adresa jde bez parametrů a kotvy', () => {
  assert.equal(stripUrl('https://k.app/search?q=tajne#a'), 'https://k.app/search');
  assert.equal(stripUrl(''), '');
});

test('hlášení obsahuje jen to, co má, a adresa je očištěná', () => {
  const r = prepareReport({ kind: 'error', message: 'Cannot read x', stack: 'TypeError: Cannot read x\n    at f (app.js:10:5)' }, CTX, createState());
  assert.ok(r);
  assert.equal(r.url, 'https://kine-lac.vercel.app/search');
  assert.equal(r.device, 'phone');
  assert.deepEqual(Object.keys(r).sort(), ['device', 'fingerprint', 'kind', 'message', 'stack', 'url', 'userAgent']);
});

test('stejná chyba se za jedno načtení pošle jen jednou', () => {
  const st = createState();
  const raw = { kind: 'error', message: 'boom', stack: 'Error: boom\n    at a (x.js:1:1)' };
  assert.ok(prepareReport(raw, CTX, st));
  assert.equal(prepareReport(raw, CTX, st), null);
  assert.equal(prepareReport({ ...raw, stack: 'Error: boom\n    at a (x.js:99:7)' }, CTX, st), null, 'jiné číslo řádku = pořád ta samá chyba');
});

test('otisk přežije nové nasazení (hash souboru, čísla řádků)', () => {
  const a = fingerprintOf('x is undefined', 'Error\n    at f (/_next/static/chunks/app-1a2b3c4d5e6f.js:12:34)');
  const b = fingerprintOf('x is undefined', 'Error\n    at f (/_next/static/chunks/app-9f8e7d6c5b4a.js:99:1)');
  assert.equal(a, b);
});

test('nejvíc MAX_PER_PAGE hlášení na načtení', () => {
  const st = createState();
  let poslano = 0;
  for (let i = 0; i < MAX_PER_PAGE + 5; i++) {
    if (prepareReport({ kind: 'error', message: 'chyba ' + i + ' ' + 'x'.repeat(i), stack: 'at f' + i }, CTX, st)) poslano++;
  }
  assert.equal(poslano, MAX_PER_PAGE);
});

test('šum a rozšíření prohlížeče se nehlásí', () => {
  const st = createState();
  assert.equal(prepareReport({ kind: 'error', message: 'ResizeObserver loop limit exceeded' }, CTX, st), null);
  assert.equal(prepareReport({ kind: 'error', message: 'Script error.' }, CTX, st), null);
  assert.equal(prepareReport({ kind: 'error', message: 'x', source: 'chrome-extension://abc/inject.js' }, CTX, st), null);
  assert.equal(prepareReport({ kind: 'error', message: '   ' }, CTX, st), null, 'prázdná zpráva');
  assert.equal(st.count, 0, 'ignorované se nepočítají do limitu');
});

test('cokoliv vyhozeného se popíše bez pádu', () => {
  assert.equal(describeThrown(new TypeError('t')).message, 't');
  assert.equal(describeThrown('řetězec').message, 'řetězec');
  assert.equal(describeThrown({ message: 'supabase', code: '42501' }).message, 'supabase');
  assert.equal(describeThrown(null).message, 'Neznámá chyba');
  assert.equal(typeof describeThrown({ a: 1 }).message, 'string');
});

test('dlouhé texty se zkrátí', () => {
  const r = prepareReport({ kind: 'rejection', message: 'm'.repeat(2000), stack: 's'.repeat(10000) }, CTX, createState());
  assert.equal(r.message.length, 500);
  assert.equal(r.stack.length, 4000);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
