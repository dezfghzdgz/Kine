/**
 * Test podepsaných tokenů pro Cloudflare Stream (lib/streamToken.ts).
 *
 * Cloudflare odsud nezavoláme, ale podpis se ověřit dá: vygeneruje se
 * pár klíčů, token se podepíše soukromým a zkontroluje veřejným - přesně
 * to, co dělá Cloudflare, když token dostane.
 *
 * Spustit:  node tests/streamToken.test.mjs
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/streamToken.ts');
const {
  createStreamToken, parseSigningKey, signingKeyFromEnv, swapPlaybackId, isCloudflareStreamUrl,
  PLAYBACK_TOKEN_TTL_S, DOWNLOAD_TOKEN_TTL_S,
} = await import(join(kam, 'streamToken.js'));

let prosly = 0;
let padly = 0;
function test(nazev, fn) {
  try { fn(); console.log('OK    ' + nazev); prosly++; }
  catch (e) { console.log('CHYBA ' + nazev + '\n      ' + e.message); padly++; }
}

// Cloudflare vydává klíč PKCS#1 ("BEGIN RSA PRIVATE KEY") a posílá ho base64.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY_ID = 'a1b2c3d4e5f6';
const pemBase64 = Buffer.from(privateKey, 'utf8').toString('base64');

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function rozeber(token) {
  const [h, p, sig] = token.split('.');
  return {
    header: JSON.parse(b64urlDecode(h).toString('utf8')),
    payload: JSON.parse(b64urlDecode(p).toString('utf8')),
    signingInput: `${h}.${p}`,
    signature: b64urlDecode(sig),
  };
}

test('klíč z prostředí: base64 PEM tak, jak ho Cloudflare vrátí', () => {
  const key = signingKeyFromEnv({ CLOUDFLARE_STREAM_KEY_ID: KEY_ID, CLOUDFLARE_STREAM_KEY_PEM: pemBase64 });
  assert.ok(key);
  assert.equal(key.id, KEY_ID);
  assert.ok(key.pem.startsWith('-----BEGIN RSA PRIVATE KEY-----'));
});

test('klíč z prostředí: holý PEM projde taky, i s "\\n" místo řádků', () => {
  const key = parseSigningKey(KEY_ID, privateKey);
  assert.equal(key.pem, privateKey.trim());
  const jednoradkovy = parseSigningKey(KEY_ID, privateKey.trim().replace(/\n/g, '\\n'));
  assert.equal(jednoradkovy.pem, privateKey.trim());
  // ...a podepisuje se s ním stejně dobře.
  assert.match(createStreamToken(jednoradkovy, 'uid', { ttlSeconds: 60 }), /^[\w-]+\.[\w-]+\.[\w-]+$/);
});

test('bez proměnných, nebo s nesmyslem, není klíč - appka se chová jako dřív', () => {
  assert.equal(signingKeyFromEnv({}), null);
  assert.equal(parseSigningKey(KEY_ID, ''), null);
  assert.equal(parseSigningKey('', pemBase64), null);
  assert.equal(parseSigningKey(KEY_ID, 'tohle-neni-klic'), null);
});

test('token má správnou hlavičku, tělo a platnost', () => {
  const key = parseSigningKey(KEY_ID, pemBase64);
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);
  const token = createStreamToken(key, 'video-uid-123', { ttlSeconds: PLAYBACK_TOKEN_TTL_S, now });
  const { header, payload } = rozeber(token);
  assert.deepEqual(header, { alg: 'RS256', kid: KEY_ID });
  assert.equal(payload.sub, 'video-uid-123');
  assert.equal(payload.kid, KEY_ID);
  assert.equal(payload.exp, Math.floor(now / 1000) + 4 * 3600);
  assert.equal(payload.nbf, Math.floor(now / 1000) - 60);
  assert.equal('downloadable' in payload, false);
});

test('podpis ověří veřejná půlka klíče (to dělá Cloudflare)', () => {
  const key = parseSigningKey(KEY_ID, pemBase64);
  const token = createStreamToken(key, 'video-uid-123', { ttlSeconds: 600 });
  const { signingInput, signature } = rozeber(token);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  assert.equal(verifier.verify(publicKey, signature), true);

  // Jiný klíč podpis neuzná.
  const cizi = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const v2 = createVerify('RSA-SHA256');
  v2.update(signingInput);
  assert.equal(v2.verify(cizi.publicKey, signature), false);
});

test('token bez padding znaků a bez +/ (base64url, jinak ho adresa rozbije)', () => {
  const key = parseSigningKey(KEY_ID, pemBase64);
  for (let i = 0; i < 5; i++) {
    const token = createStreamToken(key, 'uid' + i, { ttlSeconds: 600, now: Date.now() + i * 1000 });
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  }
});

test('token na stažení má downloadable a kratší platnost', () => {
  const key = parseSigningKey(KEY_ID, pemBase64);
  const now = Date.now();
  const token = createStreamToken(key, 'uid', { ttlSeconds: DOWNLOAD_TOKEN_TTL_S, downloadable: true, now });
  const { payload } = rozeber(token);
  assert.equal(payload.downloadable, true);
  assert.equal(payload.exp - Math.floor(now / 1000), 3600);
});

test('nesmyslné vstupy odmítne', () => {
  const key = parseSigningKey(KEY_ID, pemBase64);
  assert.throws(() => createStreamToken(key, '', { ttlSeconds: 600 }));
  assert.throws(() => createStreamToken(key, 'uid', { ttlSeconds: 0 }));
  assert.throws(() => createStreamToken(key, 'uid', { ttlSeconds: NaN }));
});

test('výměna id v adrese Cloudflare zachová cestu i parametry', () => {
  assert.equal(
    swapPlaybackId('https://customer-abc.cloudflarestream.com/UID123/thumbnails/thumbnail.jpg?time=1s&height=270', 'TOKEN'),
    'https://customer-abc.cloudflarestream.com/TOKEN/thumbnails/thumbnail.jpg?time=1s&height=270'
  );
  assert.equal(
    swapPlaybackId('https://videodelivery.net/UID123/downloads/default.mp4', 'TOKEN'),
    'https://videodelivery.net/TOKEN/downloads/default.mp4'
  );
  assert.equal(swapPlaybackId('nesmysl', 'TOKEN'), null);
  assert.equal(swapPlaybackId('https://videodelivery.net/', 'TOKEN'), null);
});

test('pozná adresu z Cloudflare Stream a nesplete ji s náhledem z úložiště', () => {
  assert.equal(isCloudflareStreamUrl('https://customer-abc.cloudflarestream.com/UID/thumbnails/thumbnail.jpg'), true);
  assert.equal(isCloudflareStreamUrl('https://videodelivery.net/UID/thumbnails/thumbnail.jpg'), true);
  assert.equal(isCloudflareStreamUrl('https://xyz.supabase.co/storage/v1/object/public/thumbnails/a/b.jpg?t=1'), false);
  assert.equal(isCloudflareStreamUrl(null), false);
  assert.equal(isCloudflareStreamUrl('blbost'), false);
});

console.log('\n' + prosly + ' prošlo, ' + padly + ' spadlo');
process.exit(padly ? 1 : 0);
