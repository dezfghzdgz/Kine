/**
 * Push oznámení: šifrování (RFC 8291 / aes128gcm), podpis VAPID (RFC 8292),
 * které adresy push služeb server bere, a co se z oznámení posílá na telefon
 * (lib/webPush.ts, lib/pushText.ts, lib/pushSend.ts).
 *
 * Dešifrování je tu napsané zvlášť podle RFC (jako to dělá prohlížeč) - když
 * se šifrování v lib/webPush.ts rozbije, zpráva v telefonu se nedá přečíst
 * a tenhle test spadne.
 *
 * Spustit:  node tests/webPush.test.mjs
 */

import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prelozit } from './prelozit.mjs';

const kam = prelozit('lib/webPush.ts', 'lib/pushText.ts', 'lib/pushSend.ts', 'lib/vapidKeygen.ts');
// Databáze tu není potřeba - jen čisté funkce z lib/pushSend.ts.
writeFileSync(join(kam, 'supabaseServer.js'), 'export const supabaseServer = {};\n');
const wp = await import(join(kam, 'webPush.js'));
const pt = await import(join(kam, 'pushText.js'));
const ps = await import(join(kam, 'pushSend.js'));
const kg = await import(join(kam, 'vapidKeygen.js'));

let prosly = 0;
let padly = 0;
async function test(nazev, fn) {
  try {
    await fn();
    console.log('OK    ' + nazev);
    prosly++;
  } catch (e) {
    console.log('CHYBA ' + nazev + '\n      ' + e.message);
    padly++;
  }
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** Prohlížeč: dešifruje zprávu ze serveru (RFC 8291 + RFC 8188, jeden záznam). */
function decrypt(body, ua, authSecret) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const record = body.subarray(21 + idlen);
  assert.equal(rs, 4096, 'velikost záznamu');
  assert.equal(idlen, 65, 'klíč serveru v hlavičce');
  const secret = ua.computeSecret(asPublic);
  const prkKey = hmac(authSecret, secret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const plain = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // Poslední záznam končí oddělovačem 0x02 (a případně nulami).
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  assert.equal(plain[end], 2, 'oddělovač posledního záznamu');
  return plain.subarray(0, end).toString('utf8');
}

function device() {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  return { ua, auth, target: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } };
}

await test('zpráva zašifrovaná serverem jde v prohlížeči přečíst (i s háčky a emoji)', () => {
  const { ua, auth, target } = device();
  const text = JSON.stringify({ title: 'Kanál Žluťoučký je živě 🔴', body: 'Příliš žluťoučký kůň úpěl ďábelské ódy', url: '/live/x' });
  const body = wp.encryptPushPayload(Buffer.from(text), target);
  assert.equal(decrypt(body, ua, auth), text);
});

await test('každá zpráva má jiný klíč i sůl (stejný text = jiný obsah)', () => {
  const { target } = device();
  const a = wp.encryptPushPayload(Buffer.from('ahoj'), target);
  const b = wp.encryptPushPayload(Buffer.from('ahoj'), target);
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16));
  assert.notDeepEqual(a.subarray(21, 86), b.subarray(21, 86));
});

await test('špatný klíč zařízení nebo moc dlouhá zpráva -> chyba, ne nesmysl', () => {
  const { target } = device();
  assert.throws(() => wp.encryptPushPayload(Buffer.from('x'), { ...target, p256dh: b64u(randomBytes(65)) }));
  assert.throws(() => wp.encryptPushPayload(Buffer.from('x'), { ...target, auth: b64u(randomBytes(8)) }));
  assert.throws(() => wp.encryptPushPayload(Buffer.alloc(4000), target));
});

await test('podpis VAPID ověří veřejný klíč (ES256, aud = adresa služby, platnost 12 h)', async () => {
  const { publicKey, privateKey } = await kg.generateVapidKeys(globalThis.crypto.subtle);
  assert.match(publicKey, /^[A-Za-z0-9_-]{87}$/);
  assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/);
  const now = Date.parse('2026-10-31T12:00:00Z');
  const header = wp.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', { publicKey, privateKey, subject: 'mailto:kinesupport@gmail.com' }, now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  assert.equal(m[4], publicKey);
  const claims = JSON.parse(unb64u(m[2]).toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, Math.floor(now / 1000) + 12 * 3600);
  assert.equal(claims.sub, 'mailto:kinesupport@gmail.com');
  const pub = unb64u(publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, unb64u(m[3])), 'podpis sedí');
});

await test('klíče z nastavení: jen celé a platné, jinak push vypnutý', () => {
  assert.equal(wp.vapidKeysFromEnv({}), null);
  assert.equal(wp.vapidKeysFromEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'kratky', VAPID_PRIVATE_KEY: 'x'.repeat(43) }), null);
  const keys = wp.vapidKeysFromEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'B'.repeat(87), VAPID_PRIVATE_KEY: 'a'.repeat(43) });
  assert.equal(keys.subject, 'mailto:kinesupport@gmail.com');
});

await test('server posílá jen push službám prohlížečů (žádné cizí adresy)', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) {
    assert.ok(wp.isPushEndpoint(ok), ok);
  }
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://evil.example.com/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.com/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://169.254.169.254/latest',
    'nesmysl',
  ]) {
    assert.ok(!wp.isPushEndpoint(bad), bad);
  }
});

await test('odeslání: 410 = zařízení se odhlásilo (smazat), 201 = doručeno', async () => {
  const { target } = device();
  const { publicKey, privateKey } = await kg.generateVapidKeys(globalThis.crypto.subtle);
  const keys = { publicKey, privateKey, subject: 'mailto:kinesupport@gmail.com' };
  let seen = null;
  const fake = (status) => async (url, init) => {
    seen = { url, init };
    return new Response(null, { status });
  };
  const full = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...target };
  const ok = await wp.sendWebPush(full, { title: 'x' }, keys, { fetchImpl: fake(201), ttl: 60, urgency: 'high', topic: 'live-abc' });
  assert.deepEqual(ok, { ok: true, status: 201, gone: false });
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers.TTL, '60');
  assert.equal(seen.init.headers.Urgency, 'high');
  assert.equal(seen.init.headers.Topic, 'live-abc');
  const gone = await wp.sendWebPush(full, { title: 'x' }, keys, { fetchImpl: fake(410) });
  assert.deepEqual(gone, { ok: false, status: 410, gone: true });
});

await test('na telefon jen vybrané druhy oznámení (lajky a odběry jen ve zvonečku)', () => {
  assert.equal(ps.pushCategory({ type: 'live', link: '/live/x', sender_id: null }), 'live');
  assert.equal(ps.pushCategory({ type: 'new_video', link: '/watch/x', sender_id: null }), 'uploads');
  assert.equal(ps.pushCategory({ type: 'new_post', link: '/post/x', sender_id: null }), 'uploads');
  assert.equal(ps.pushCategory({ type: 'comment_reply', link: '/watch/x', sender_id: 'u' }), 'replies');
  assert.equal(ps.pushCategory({ type: 'donation', link: '/channel-stats', sender_id: null }), 'earnings');
  assert.equal(ps.pushCategory({ type: 'default', link: '/admin/costs', sender_id: null }), 'admin');
  // Od uživatele vložené "živě" / "nové video" se neposílá (to vkládá jen server).
  assert.equal(ps.pushCategory({ type: 'live', link: '/live/x', sender_id: 'u' }), null);
  assert.equal(ps.pushCategory({ type: 'default', link: '/admin/costs', sender_id: 'u' }), null);
  assert.equal(ps.pushCategory({ type: 'like', link: '/watch/x', sender_id: 'u' }), null);
  assert.equal(ps.pushCategory({ type: 'subscribe', link: '/channel/x', sender_id: 'u' }), null);
});

await test('odkaz v oznámení vede jen dovnitř Kine', () => {
  assert.equal(ps.safePushUrl('/watch/abc'), '/watch/abc');
  assert.equal(ps.safePushUrl('https://evil.example.com'), '/');
  assert.equal(ps.safePushUrl('//evil.example.com'), '/');
  assert.equal(ps.safePushUrl('/\\evil.example.com'), '/');
  assert.equal(ps.safePushUrl(null), '/');
});

await test('texty oznámení ve všech 8 jazycích, s doplněnými údaji', () => {
  assert.deepEqual([...pt.PUSH_LANGS].sort(), ['cs', 'de', 'en', 'es', 'fr', 'pl', 'sk', 'uk']);
  for (const lang of pt.PUSH_LANGS) {
    const title = pt.pushText(lang, 'liveTitle', { name: 'Kanál' });
    assert.ok(title.includes('Kanál'), `${lang}: ${title}`);
    assert.ok(!/\{[a-z]+\}/.test(title), `${lang}: nedoplněno ${title}`);
  }
  assert.ok(pt.isPushLang('cs'));
  assert.ok(!pt.isPushLang('xx'));
  assert.equal(pt.clip('a'.repeat(200), 10).length <= 10, true);
});

console.log(`\n${prosly} prošlo, ${padly} spadlo`);
if (padly > 0) process.exit(1);
