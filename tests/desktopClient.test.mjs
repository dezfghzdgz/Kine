/**
 * Test rozpoznání appky do PC a její verze (lib/desktopClient.ts) a obrázků
 * jen z důvěryhodných míst (lib/trustedMedia.ts).
 *
 * Spustit:  node tests/desktopClient.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/desktopClient.ts', 'lib/trustedMedia.ts');
const D = await import(join(kam, 'desktopClient.js'));
const M = await import(join(kam, 'trustedMedia.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

const h = (o) => ({ get: (k) => o[k.toLowerCase()] ?? null });

test('hlavička X-Kine-App (appka od 0.11.0)', () => {
  assert.deepEqual(D.kineAppFrom(h({ 'x-kine-app': 'clipper/0.11.0' })), { variant: 'clipper', version: '0.11.0', legacy: false });
  assert.deepEqual(D.kineAppFrom(h({ 'x-kine-app': 'full/1.2.10', 'user-agent': 'node' })), { variant: 'full', version: '1.2.10', legacy: false });
  assert.equal(D.kineAppFrom(h({ 'x-kine-app': 'nesmysl' , 'user-agent': 'Mozilla/5.0' })), null, 'neplatná hlavička z prohlížeče = prohlížeč');
});

test('mobilní appka (android/…) má vlastní minimum ANDROID_MIN_VERSION', () => {
  assert.deepEqual(D.kineAppFrom(h({ 'x-kine-app': 'android/0.1.0', 'user-agent': 'Dalvik/2.1.0 (Linux; U; Android 14)' })), { variant: 'android', version: '0.1.0', legacy: false });
  assert.equal(D.androidMinVersion({}), null, 'bez proměnné se mobil nehlídá');
  assert.equal(D.androidMinVersion({ ANDROID_MIN_VERSION: '0.2.0' }), '0.2.0');
  assert.equal(D.androidMinVersion({ ANDROID_MIN_VERSION: 'nesmysl' }), null);
});

test('stará appka bez hlavičky (Node.js) vs. prohlížeč', () => {
  assert.deepEqual(D.kineAppFrom(h({ 'user-agent': 'node' })), { variant: null, version: null, legacy: true });
  assert.deepEqual(D.kineAppFrom(h({ 'user-agent': 'undici' })), { variant: null, version: null, legacy: true });
  assert.equal(D.kineAppFrom(h({ 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' })), null);
  assert.deepEqual(D.kineAppFrom(h({ 'user-agent': 'node', 'sec-fetch-mode': 'cors', 'accept-language': '*' })), { variant: null, version: null, legacy: true }, 'přesně to posílá fetch v Node.js (i Sec-Fetch-Mode)');
  assert.equal(D.kineAppFrom(h({ 'user-agent': 'node', 'sec-fetch-site': 'same-origin' })), null, 'prohlížeč posílá Sec-Fetch-Site');
  assert.equal(D.kineAppFrom(h({})), null, 'bez User-Agentu se nic nehlídá');
});

test('porovnání verzí', () => {
  assert.equal(D.compareVersions('0.10.9', '0.11.0'), -1);
  assert.equal(D.compareVersions('0.11.0', '0.11.0'), 0);
  assert.equal(D.compareVersions('0.11.1', '0.11.0'), 1);
  assert.equal(D.compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(D.compareVersions('0.9.10', '0.9.9'), 1, 'čísla, ne text');
  assert.equal(D.compareVersions('abc', '0.0.1'), -1);
});

test('nejstarší povolená verze', () => {
  assert.equal(D.desktopMinVersion({}), D.DEFAULT_DESKTOP_MIN_VERSION);
  assert.equal(D.desktopMinVersion({ DESKTOP_MIN_VERSION: '0.12.3' }), '0.12.3');
  assert.equal(D.desktopMinVersion({ DESKTOP_MIN_VERSION: 'off' }), null);
  assert.equal(D.desktopMinVersion({ DESKTOP_MIN_VERSION: 'blbost' }), D.DEFAULT_DESKTOP_MIN_VERSION);
});

test('zastaralá appka - jen když je nová verze opravdu venku', () => {
  const stará = { variant: null, version: null, legacy: true };
  const nová = { variant: 'clipper', version: '0.11.0', legacy: false };
  const předchozí = { variant: 'full', version: '0.10.9', legacy: false };
  assert.equal(D.isOutdatedApp(stará, '0.11.0', '0.10.9'), false, 'nová verze ještě není vydaná - nic se neblokuje');
  assert.equal(D.isOutdatedApp(stará, '0.11.0', null), false, 'nevíme, co je vydané - nic se neblokuje');
  assert.equal(D.isOutdatedApp(stará, '0.11.0', '0.11.0'), true);
  assert.equal(D.isOutdatedApp(předchozí, '0.11.0', '0.11.2'), true);
  assert.equal(D.isOutdatedApp(nová, '0.11.0', '0.11.2'), false);
  assert.equal(D.isOutdatedApp(null, '0.11.0', '0.11.2'), false, 'prohlížeč nikdy');
  assert.equal(D.isOutdatedApp(stará, null, '0.11.2'), false, 'vypnuto');
});

test('obrázky jen z důvěryhodných míst', () => {
  const own = 'abcxyz.supabase.co';
  assert.equal(M.trustedImageUrl('https://abcxyz.supabase.co/storage/v1/object/public/avatars/u/avatar.png', own), 'https://abcxyz.supabase.co/storage/v1/object/public/avatars/u/avatar.png');
  // Cizí projekt Supabase ne - jen vlastní (lib/trustedMedia.ts); bez známé vlastní adresy jakýkoli.
  assert.equal(M.trustedImageUrl('https://other.supabase.co/x.png', own), null);
  assert.ok(M.trustedImageUrl('https://other.supabase.co/x.png', null));
  assert.ok(M.trustedImageUrl('https://customer-abc123.cloudflarestream.com/uid/thumbnails/thumbnail.jpg', own));
  assert.ok(M.trustedImageUrl('https://videodelivery.net/uid/thumbnails/thumbnail.jpg', own));
  assert.ok(M.trustedImageUrl('https://media2.giphy.com/media/x/giphy.gif', own));
  assert.ok(M.trustedImageUrl('/icon.svg', own));
  assert.equal(M.trustedImageUrl('//evil.example/x.png', own), null);
  assert.equal(M.trustedImageUrl('https://evil.example/track.gif', own), null, 'cizí server ne');
  assert.equal(M.trustedImageUrl('https://supabase.co.evil.example/x.png', own), null);
  assert.equal(M.trustedImageUrl('http://abcxyz.supabase.co/x.png', 'kine.local'), null, 'http jen pro vlastní Supabase / localhost');
  assert.ok(M.trustedImageUrl('http://127.0.0.1:54321/storage/v1/object/public/avatars/x.png', '127.0.0.1:54321'), 'vývoj a testy');
  assert.equal(M.trustedImageUrl('javascript:alert(1)', own), null);
  assert.equal(M.trustedImageUrl(null, own), null);
  assert.equal(M.trustedImageUrl('  ', own), null);
});

console.log(`\n${prosly} prošlo, ${padly} padlo`);
process.exit(padly ? 1 : 0);
