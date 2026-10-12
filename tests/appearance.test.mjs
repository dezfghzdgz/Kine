/**
 * Test vzhledu (lib/appearance.ts): co se uloží, co dostane <html>
 * a že skript v <head> zvládne i rozbitou paměť prohlížeče.
 *
 * Spustit:  node tests/appearance.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/appearance.ts');
const { sanitizeAppearance, appearanceAttributes, parseTheme, DEFAULT_APPEARANCE, APPEARANCE_BOOT_SCRIPT, setAmbientSource, currentAmbientSource, onAmbientSource } = await import(
  join(kam, 'appearance.js')
);

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

/** Napodobený <html> a localStorage pro skript z <head>. */
function fakeDocument(stored) {
  const attrs = new Map();
  const vars = new Map();
  const documentElement = {
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    style: { setProperty: (k, v) => vars.set(k, String(v)) },
  };
  const localStorage = { getItem: (k) => (k in stored ? stored[k] : null) };
  new Function('document', 'window', APPEARANCE_BOOT_SCRIPT)({ documentElement }, { localStorage });
  return { attrs, vars };
}

test('výchozí vzhled: klasický, pozadí podle videa, světlo kolem videa zapnuté', () => {
  assert.deepEqual(sanitizeAppearance(null), DEFAULT_APPEARANCE);
  assert.equal(DEFAULT_APPEARANCE.look, 'classic');
  assert.equal(DEFAULT_APPEARANCE.ambient, true);
});

test('rozbitá nebo cizí data -> platný vzhled (síla 0-100, známé hodnoty)', () => {
  assert.deepEqual(sanitizeAppearance({ look: 'glass', backdrop: 'sunset', strength: 250, ambient: false }), { look: 'glass', backdrop: 'sunset', strength: 100, ambient: false });
  assert.deepEqual(sanitizeAppearance({ look: 'neon', backdrop: '<script>', strength: 'x', ambient: 'ano' }), DEFAULT_APPEARANCE);
  assert.equal(sanitizeAppearance({ strength: -5 }).strength, 0);
  assert.equal(sanitizeAppearance({ strength: 42.6 }).strength, 43);
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('rainbow'), 'dark');
});

test('atributy pro <html>: sklo jen když je zapnuté, síla jako --glass-k', () => {
  const glass = appearanceAttributes('gray', { look: 'glass', backdrop: 'ocean', strength: 80, ambient: false });
  assert.deepEqual(glass.attrs, { 'data-theme': 'gray', 'data-look': 'glass', 'data-backdrop': 'ocean', 'data-ambient': '0' });
  assert.equal(glass.glassK, '0.8');
  const classic = appearanceAttributes('dark', DEFAULT_APPEARANCE);
  assert.equal(classic.attrs['data-look'], null);
  assert.equal(classic.attrs['data-ambient'], '1');
});

test('skript v <head>: uložený vzhled se nastaví hned (bez přebliknutí)', () => {
  const { attrs, vars } = fakeDocument({ 'kine-theme': 'light', 'kine-appearance': JSON.stringify({ look: 'glass', backdrop: 'neon', strength: 30, ambient: false }) });
  assert.equal(attrs.get('data-theme'), 'light');
  assert.equal(attrs.get('data-look'), 'glass');
  assert.equal(attrs.get('data-backdrop'), 'neon');
  assert.equal(attrs.get('data-ambient'), '0');
  assert.equal(vars.get('--glass-k'), '0.3');
});

test('skript v <head>: nic uloženého / rozbitý JSON / cizí hodnoty -> výchozí, žádná chyba', () => {
  const empty = fakeDocument({});
  assert.equal(empty.attrs.get('data-look'), undefined);
  assert.equal(empty.attrs.get('data-backdrop'), 'auto');
  assert.equal(empty.attrs.get('data-ambient'), '1');
  assert.equal(empty.vars.get('--glass-k'), String(DEFAULT_APPEARANCE.strength / 100));
  const broken = fakeDocument({ 'kine-theme': 'evil"', 'kine-appearance': '{nejde to' });
  assert.equal(broken.attrs.get('data-theme'), undefined);
  assert.equal(broken.attrs.get('data-backdrop'), 'auto');
  const odd = fakeDocument({ 'kine-appearance': JSON.stringify({ backdrop: 'x', strength: 999 }) });
  assert.equal(odd.attrs.get('data-backdrop'), 'auto');
  assert.equal(odd.vars.get('--glass-k'), '1');
});

test('pozadí podle videa: jen http(s) adresy, posluchač dostane změny', () => {
  const seen = [];
  const off = onAmbientSource((u) => seen.push(u));
  setAmbientSource('https://videodelivery.net/abc/thumbnails/thumbnail.jpg');
  setAmbientSource('https://videodelivery.net/abc/thumbnails/thumbnail.jpg');
  setAmbientSource('javascript:alert(1)');
  setAmbientSource(null);
  off();
  setAmbientSource('https://example.com/x.jpg');
  assert.deepEqual(seen, ['https://videodelivery.net/abc/thumbnails/thumbnail.jpg', null]);
  assert.equal(currentAmbientSource(), 'https://example.com/x.jpg');
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
