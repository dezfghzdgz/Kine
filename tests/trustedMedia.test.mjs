/**
 * Test obrázků od lidí (lib/trustedMedia.ts): ukázat jde jen obrázek z úložiště
 * Kine, z Cloudflare Stream nebo z Giphy - cizí server by jinak zjistil IP
 * adresu každého, kdo stránku otevře.
 *
 * Spustit:  node tests/trustedMedia.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/trustedMedia.ts');
const M = await import(join(kam, 'trustedMedia.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const OWN = 'abcd.supabase.co';

test('úložiště Kine, Cloudflare a Giphy projdou', () => {
  for (const url of [
    'https://abcd.supabase.co/storage/v1/object/public/avatars/u1/a.png',
    'https://customer-abc123.cloudflarestream.com/uid/thumbnails/thumbnail.jpg',
    'https://videodelivery.net/uid/thumbnails/thumbnail.jpg',
    'https://imagedelivery.net/hash/id/public',
    'https://media.giphy.com/media/x/giphy.gif',
    'https://media2.giphy.com/media/x/giphy.gif',
    'https://i.giphy.com/x.gif',
  ]) {
    assert.equal(M.trustedImageUrl(url, OWN), url, url);
  }
});

test('cizí projekt Supabase ne (v logu by viděl IP diváků); bez vlastní adresy ano', () => {
  assert.equal(M.trustedImageUrl('https://jiny.supabase.co/storage/v1/object/public/post-images/u1/x.webp', OWN), null);
  assert.equal(M.trustedImageUrl('https://jiny.supabase.co/a.webp', null), 'https://jiny.supabase.co/a.webp');
  assert.equal(M.isTrustedImageHost('stary.supabase.co', OWN, ['stary.supabase.co']), true, 'starý projekt přes NEXT_PUBLIC_EXTRA_IMAGE_HOSTS');
});

test('cizí servery ne (IP adresa diváka)', () => {
  for (const url of [
    'https://evil.example.com/pixel.gif',
    'https://supabase.co.evil.com/a.png',
    'https://abcd.supabase.co.evil.com/a.png',
    'https://customer-abc.cloudflarestream.com.evil.net/a.jpg',
    'https://notgiphy.com/a.gif',
    'https://media.giphy.com.evil.io/a.gif',
    'https://evil.com/?https://abcd.supabase.co/a.png',
  ]) {
    assert.equal(M.trustedImageUrl(url, OWN), null, url);
  }
});

test('jen https (http jen vlastní Supabase a localhost při vývoji)', () => {
  assert.equal(M.trustedImageUrl('http://jiny.supabase.co/a.png', OWN), null);
  assert.equal(M.trustedImageUrl('http://abcd.supabase.co/a.png', OWN), 'http://abcd.supabase.co/a.png');
  assert.equal(M.trustedImageUrl('http://localhost:54321/storage/v1/object/public/a.png', OWN), 'http://localhost:54321/storage/v1/object/public/a.png');
  assert.equal(M.trustedImageUrl('http://127.0.0.1:54321/a.png', 'localhost:54321'), 'http://127.0.0.1:54321/a.png');
  assert.equal(M.trustedImageUrl('ftp://abcd.supabase.co/a.png', OWN), null);
  assert.equal(M.trustedImageUrl('javascript:alert(1)', OWN), null);
});

test('relativní adresy na Kine, data:image a blob projdou, // ne', () => {
  assert.equal(M.trustedImageUrl('/emotes/kineHype.svg', OWN), '/emotes/kineHype.svg');
  assert.equal(M.trustedImageUrl('//evil.com/a.png', OWN), null, 'adresa bez protokolu = cizí server');
  assert.equal(M.trustedImageUrl('data:image/png;base64,iVBORw0KGgo=', OWN), 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(M.trustedImageUrl('data:text/html,<b>x</b>', OWN), null);
  assert.equal(M.trustedImageUrl('blob:https://www.playkine.com/1234', OWN), 'blob:https://www.playkine.com/1234');
});

test('prázdné a nesmyslné hodnoty', () => {
  assert.equal(M.trustedImageUrl(null, OWN), null);
  assert.equal(M.trustedImageUrl(undefined, OWN), null);
  assert.equal(M.trustedImageUrl('', OWN), null);
  assert.equal(M.trustedImageUrl('   ', OWN), null);
  assert.equal(M.trustedImageUrl(42, OWN), null);
  assert.equal(M.trustedImageUrl('není adresa', OWN), null);
  assert.equal(M.trustedImageUrl('  https://abcd.supabase.co/a.png  ', OWN), 'https://abcd.supabase.co/a.png', 'mezery okolo se oříznou');
});

test('velká písmena v adrese serveru nevadí', () => {
  assert.equal(M.isTrustedImageHost('ABCD.SUPABASE.CO', OWN), true);
  assert.equal(M.isTrustedImageHost('Media.Giphy.com', OWN), true);
  assert.equal(M.isTrustedImageHost('evil.example.com', OWN), false);
  assert.equal(M.isTrustedImageHost('vlastni-server.cz', 'vlastni-server.cz'), true, 'vlastní Supabase na jiné doméně');
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
if (padly > 0) process.exit(1);
