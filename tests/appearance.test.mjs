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
const { sanitizeAppearance, appearanceAttributes, parseTheme, DEFAULT_APPEARANCE, APPEARANCE_BOOT_SCRIPT, setAmbientSource, currentAmbientSource, onAmbientSource, videoFrameUrl, liveFrameUrl, FOLLOW_VIDEO_MS, FOLLOW_LIVE_MS } = await import(
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
  assert.deepEqual(sanitizeAppearance({ look: 'glass', backdrop: 'sunset', strength: 250, ambient: false, follow: true, motion: true }), {
    ...DEFAULT_APPEARANCE,
    look: 'glass',
    backdrop: 'sunset',
    strength: 100,
    ambient: false,
    follow: true,
    motion: true,
  });
  assert.equal(sanitizeAppearance({ follow: 'ano', motion: 1 }).follow, false, 'jen skutečné true/false');
  assert.deepEqual(sanitizeAppearance({ look: 'neon', backdrop: '<script>', strength: 'x', ambient: 'ano' }), DEFAULT_APPEARANCE);
  assert.equal(sanitizeAppearance({ strength: -5 }).strength, 0);
  assert.equal(sanitizeAppearance({ strength: 42.6 }).strength, 43);
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('rainbow'), 'dark');
});

test('atributy pro <html>: sklo jen když je zapnuté, síla jako --glass-k', () => {
  const glass = appearanceAttributes('gray', { ...DEFAULT_APPEARANCE, look: 'glass', backdrop: 'ocean', strength: 80, ambient: false, follow: true, motion: true });
  assert.deepEqual(glass.attrs, {
    'data-theme': 'gray',
    'data-look': 'glass',
    'data-backdrop': 'ocean',
    'data-ambient': '0',
    'data-motion': '1',
    'data-text': null,
    'data-corners': null,
    'data-cards': null,
    'data-calm': null,
  });
  assert.equal(glass.glassK, '0.8');
  const classic = appearanceAttributes('dark', DEFAULT_APPEARANCE);
  assert.equal(classic.attrs['data-look'], null);
  assert.equal(classic.attrs['data-ambient'], '1');
});

test('nové volby: písmo, rohy, karty, klidný režim, můj obrázek a jeho rozmazání', () => {
  const a = sanitizeAppearance({ backdrop: 'image', blur: 130, text: 'l', corners: 'round', cards: 's', calm: true });
  assert.equal(a.backdrop, 'image');
  assert.equal(a.blur, 100);
  assert.deepEqual([a.text, a.corners, a.cards, a.calm], ['l', 'round', 's', true]);
  // cizí hodnoty -> výchozí
  const b = sanitizeAppearance({ blur: 'x', text: 'xl', corners: 'oval', cards: 7, calm: 'ano' });
  assert.deepEqual([b.blur, b.text, b.corners, b.cards, b.calm], [40, 'm', 'normal', 'm', false]);
  // výchozí hodnoty bez atributů, odchylky jako atributy
  const attrs = appearanceAttributes('dark', a);
  assert.equal(attrs.attrs['data-text'], 'l');
  assert.equal(attrs.attrs['data-corners'], 'round');
  assert.equal(attrs.attrs['data-cards'], 's');
  assert.equal(attrs.attrs['data-calm'], '1');
  assert.equal(attrs.blurK, '1');
  const plain = appearanceAttributes('dark', DEFAULT_APPEARANCE);
  assert.deepEqual([plain.attrs['data-text'], plain.attrs['data-corners'], plain.attrs['data-cards'], plain.attrs['data-calm']], [null, null, null, null]);
  // skript v <head> to nastaví hned
  const { attrs: html, vars } = fakeDocument({ 'kine-appearance': JSON.stringify({ text: 's', corners: 'sharp', cards: 'l', calm: true, blur: 10, backdrop: 'image' }) });
  assert.equal(html.get('data-text'), 's');
  assert.equal(html.get('data-corners'), 'sharp');
  assert.equal(html.get('data-cards'), 'l');
  assert.equal(html.get('data-calm'), '1');
  assert.equal(html.get('data-backdrop'), 'image');
  assert.equal(vars.get('--blur-k'), '0.1');
  const weird = fakeDocument({ 'kine-appearance': JSON.stringify({ text: '<b>', corners: 1, cards: 'xl' }) });
  assert.equal(weird.attrs.get('data-text'), undefined);
  assert.equal(weird.attrs.get('data-corners'), undefined);
  assert.equal(weird.attrs.get('data-cards'), undefined);
  assert.equal(weird.vars.get('--blur-k'), String(DEFAULT_APPEARANCE.blur / 100));
});

test('skript v <head>: uložený vzhled se nastaví hned (bez přebliknutí)', () => {
  const { attrs, vars } = fakeDocument({ 'kine-theme': 'light', 'kine-appearance': JSON.stringify({ look: 'glass', backdrop: 'neon', strength: 30, ambient: false, motion: true }) });
  assert.equal(attrs.get('data-motion'), '1');
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

test('snímek z videa v čase: každou sekundu (stejná sekunda = stejná adresa), malý, i s podepsaným tokenem', () => {
  assert.equal(videoFrameUrl('abc123', 0), 'https://videodelivery.net/abc123/thumbnails/thumbnail.jpg?time=0s&height=72');
  assert.equal(videoFrameUrl('abc123', 7.9), 'https://videodelivery.net/abc123/thumbnails/thumbnail.jpg?time=7s&height=72');
  assert.equal(videoFrameUrl('abc123', 7.1), videoFrameUrl('abc123', 7.9));
  assert.equal(videoFrameUrl('abc123', -5), 'https://videodelivery.net/abc123/thumbnails/thumbnail.jpg?time=0s&height=72');
  assert.match(videoFrameUrl('eyJhbGc.x/y', 30), /eyJhbGc\.x%2Fy\/thumbnails/);
  assert.equal(FOLLOW_VIDEO_MS, 1000);
});

test('snímek živého přenosu: nová adresa každé 2 s (mezipaměť ho nedrží)', () => {
  assert.equal(FOLLOW_LIVE_MS, 2000);
  assert.equal(liveFrameUrl('live1', 10_000), liveFrameUrl('live1', 11_999));
  assert.notEqual(liveFrameUrl('live1', 11_999), liveFrameUrl('live1', 12_000));
  assert.match(liveFrameUrl('a/b', 0), /^https:\/\/videodelivery\.net\/a%2Fb\/thumbnails\/thumbnail\.jpg\?height=72&t=0$/);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly) process.exit(1);
