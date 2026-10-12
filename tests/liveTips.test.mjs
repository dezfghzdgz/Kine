/**
 * Test podpor ve vysílání (lib/liveTips.ts): rozsahy částek, poplatek Kine
 * (procento, ale aspoň na poplatek Stripe), vzkaz a formát částky.
 *
 * Spustit:  node tests/liveTips.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/liveTips.ts');
const T = await import(join(kam, 'liveTips.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

test('měna: jen Kč a €, výchozí podle jazyka (Slovensko eura)', () => {
  assert.equal(T.parseTipCurrency('CZK'), 'czk');
  assert.equal(T.parseTipCurrency(' eur '), 'eur');
  assert.equal(T.parseTipCurrency('usd'), null);
  assert.equal(T.parseTipCurrency(5), null);
  assert.equal(T.defaultTipCurrency('cs'), 'czk');
  assert.equal(T.defaultTipCurrency('sk'), 'eur');
  assert.equal(T.defaultTipCurrency(undefined), 'eur');
});

test('částka: rozsah 50-10 000 Kč / 2-400 €, koruny celé, eura na centy', () => {
  assert.equal(T.tipAmountCents(100, 'czk'), 10000);
  assert.equal(T.tipAmountCents('150', 'czk'), 15000);
  assert.equal(T.tipAmountCents(49, 'czk'), null);
  assert.equal(T.tipAmountCents(10001, 'czk'), null);
  assert.equal(T.tipAmountCents(99.6, 'czk'), 10000, 'haléře se zaokrouhlí na celé koruny');
  assert.equal(T.tipAmountCents('2,50', 'eur'), 250);
  assert.equal(T.tipAmountCents(1.99, 'eur'), null);
  assert.equal(T.tipAmountCents(400, 'eur'), 40000);
  assert.equal(T.tipAmountCents('abc', 'eur'), null);
  assert.equal(T.tipAmountCents(Infinity, 'eur'), null);
  assert.equal(T.tipAmountCents(null, 'eur'), null);
});

test('poplatek: procento z proměnné (0-50, jinak 15), ale aspoň 8 Kč / 0,30 €', () => {
  assert.equal(T.tipFeePercent(undefined), 15);
  assert.equal(T.tipFeePercent(''), 15);
  assert.equal(T.tipFeePercent('10'), 10);
  assert.equal(T.tipFeePercent('80'), 15, 'nesmysl -> výchozí');
  assert.equal(T.tipFeePercent('abc'), 15);
  assert.equal(T.tipFeeCents(10000, 15, 'czk'), 1500, '100 Kč -> 15 Kč');
  assert.equal(T.tipFeeCents(5000, 15, 'czk'), 800, '50 Kč -> minimum 8 Kč');
  assert.equal(T.tipFeeCents(200, 15, 'eur'), 30, '2 € -> minimum 0,30 €');
  assert.equal(T.tipFeeCents(2000, 15, 'eur'), 300);
  assert.equal(T.tipFeeCents(10000, 0, 'czk'), 0, 'při 0 % žádný poplatek');
  assert.equal(T.tipFeeCents(-5, 15, 'czk'), 0);
  assert.equal(T.creatorShareCents(10000, 15, 'czk'), 8500);
});

test('vzkaz: jeden řádek, bez okrajů, nejvýš 200 znaků', () => {
  assert.equal(T.cleanTipMessage('  ahoj\n\n  světe  '), 'ahoj světe');
  assert.equal(T.cleanTipMessage(undefined), '');
  assert.equal(T.cleanTipMessage('x'.repeat(500)).length, 200);
});

test('formát částky: bez zbytečných desetin', () => {
  assert.match(T.formatTipAmount(10000, 'czk', 'cs'), /^100\s*Kč$/);
  assert.match(T.formatTipAmount(500, 'eur', 'en'), /^€5$/);
  assert.match(T.formatTipAmount(250, 'eur', 'cs'), /^2,50\s*€$/);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
