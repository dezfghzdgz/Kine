/**
 * Test animovaných profilovek (lib/animatedImage.ts): pozná animaci podle
 * obsahu (GIF, WebP, APNG), cesty v úložišti a adresa statického snímku.
 *
 * Spustit:  node tests/animatedImage.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/animatedImage.ts');
const a = await import(join(kam, 'animatedImage.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const bytes = (...parts) => {
  const out = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
};

// Nejmenší GIF 1x1 (globální paleta 2 barvy) - jeden snímek, nebo dva.
const gifHead = bytes('GIF89a', [1, 0, 1, 0, 0x80, 0, 0], [0xff, 0xff, 0xff, 0, 0, 0]);
const loop = bytes([0x21, 0xff, 0x0b], 'NETSCAPE2.0', [3, 1, 0, 0, 0]);
const frame = bytes([0x21, 0xf9, 4, 0, 10, 0, 0, 0], [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0], [2, 2, 0x44, 1, 0]);
const gif = (...frames) => bytes(gifHead, loop, ...frames, [0x3b]);

test('GIF: jeden snímek = statický, dva = animace', () => {
  assert.equal(a.gifFrameCount(gif(frame)), 1);
  assert.equal(a.gifFrameCount(gif(frame, frame), 10), 2);
  assert.equal(a.gifFrameCount(gif(frame, frame, frame), 10), 3);
  assert.equal(a.isAnimatedImage(gif(frame)), false);
  assert.equal(a.isAnimatedImage(gif(frame, frame)), true);
  // Snímek s vlastní paletou (4 barvy) se přeskočí správně.
  const local = bytes([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0x81], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [2, 2, 0x44, 1, 0]);
  assert.equal(a.gifFrameCount(gif(local, frame), 10), 2);
  // Useknutý / rozbitý soubor nespadne.
  assert.equal(a.gifFrameCount(gif(frame, frame).slice(0, 30), 10) <= 1, true);
  assert.equal(a.gifFrameCount(bytes('nic')), 0);
});

test('WebP: příznak animace ve VP8X', () => {
  const webp = (flags) => bytes('RIFF', [30, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [flags, 0, 0, 0], [0, 0, 0, 0, 0, 0]);
  assert.equal(a.isAnimatedImage(webp(0x02)), true);
  assert.equal(a.isAnimatedImage(webp(0x12)), true); // animace + alfa
  assert.equal(a.isAnimatedImage(webp(0x10)), false); // jen alfa
  assert.equal(a.isAnimatedImage(bytes('RIFF', [30, 0, 0, 0], 'WEBP', 'VP8 ', [10, 0, 0, 0])), false);
});

test('PNG: acTL s víc snímky = APNG, obyčejné PNG ne', () => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type, data) => bytes([0, 0, 0, data.length], type, data, [0, 0, 0, 0]);
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const idat = chunk('IDAT', [1, 2, 3]);
  assert.equal(a.isAnimatedImage(bytes(sig, ihdr, chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]), idat)), true);
  assert.equal(a.isAnimatedImage(bytes(sig, ihdr, chunk('acTL', [0, 0, 0, 1, 0, 0, 0, 0]), idat)), false);
  assert.equal(a.isAnimatedImage(bytes(sig, ihdr, idat, chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]))), false);
});

test('typy a cesty v úložišti', () => {
  assert.equal(a.profileImageExtension('image/gif'), 'gif');
  assert.equal(a.profileImageExtension('IMAGE/JPEG'), 'jpg');
  assert.equal(a.profileImageExtension('image/svg+xml'), null);
  assert.equal(a.profileImageExtension('video/mp4'), null);
  assert.deepEqual(a.profileImagePaths('u1', 'avatar', 'gif', true), { main: 'u1/avatar-anim.gif', still: 'u1/avatar-still.webp' });
  assert.deepEqual(a.profileImagePaths('u1', 'banner', 'png', false), { main: 'u1/banner.png', still: null });
});

test('adresa statického snímku jen u animace (i s ?t=)', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/avatars/u1';
  assert.equal(a.stillUrlFor(`${base}/avatar-anim.gif?t=123`), `${base}/avatar-still.webp?t=123`);
  assert.equal(a.stillUrlFor(`${base}/banner-anim.webp`), `${base}/banner-still.webp`);
  assert.equal(a.stillUrlFor(`${base}/avatar.gif?t=1`), null);
  assert.equal(a.stillUrlFor(`${base}/avatar.jpg`), null);
  assert.equal(a.stillUrlFor(null), null);
  assert.equal(a.stillUrlFor('https://evil/x-anim.gif'), null);
});

test('kdy animace hraje', () => {
  // výchozí: v seznamu po najetí, na kanálu pořád; méně pohybu = nikde
  assert.equal(a.shouldAnimate('hover', 'hover', false, false), false);
  assert.equal(a.shouldAnimate('hover', 'hover', true, false), true);
  assert.equal(a.shouldAnimate('hover', 'always', false, false), true);
  assert.equal(a.shouldAnimate('hover', 'always', false, true), false);
  assert.equal(a.shouldAnimate('hover', 'hover', true, true), false);
  // výslovně "vždy" platí i s omezeným pohybem, "nikdy" všude
  assert.equal(a.shouldAnimate('always', 'hover', false, true), true);
  assert.equal(a.shouldAnimate('never', 'always', true, false), false);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
