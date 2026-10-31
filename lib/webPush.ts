import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign as cryptoSign } from 'node:crypto';

/**
 * Web Push bez knihovny (jen node:crypto): šifrování obsahu podle RFC 8291
 * (aes128gcm, RFC 8188) a podpis serveru VAPID (RFC 8292, ES256).
 *
 * Proč vlastní: je to ~150 řádků a odpadá další balíček v package.json.
 * Správnost hlídá test tests/webPush.test.mjs - obsah zašifrovaný tady
 * dešifruje zvlášť napsané dešifrování podle RFC (jako prohlížeč) a podpis
 * ověří veřejný klíč. Při vývoji to navíc dešifrovala i referenční
 * knihovna http_ece.
 *
 * Klíče VAPID (pár P-256, base64url): NEXT_PUBLIC_VAPID_PUBLIC_KEY a
 * VAPID_PRIVATE_KEY ve Vercelu - vygeneruje je Admin -> Push oznámení.
 */

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export type PushResult = { ok: boolean; status: number; gone: boolean };

export function b64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Buffer {
  const s = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(s + '='.repeat((4 - (s.length % 4)) % 4), 'base64');
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** HKDF-Expand pro jeden blok (délka do 32 bajtů - víc tu není potřeba). */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

const RECORD_SIZE = 4096;

/**
 * Zašifruje zprávu pro jedno zařízení (RFC 8291). `asPrivateKey` a `salt`
 * jen pro test se známými hodnotami - jinak náhodné pro každou zprávu.
 */
export function encryptPushPayload(
  payload: Uint8Array,
  target: { p256dh: string; auth: string },
  testing?: { asPrivateKey?: Buffer; salt?: Buffer }
): Buffer {
  const uaPublic = b64urlDecode(target.p256dh);
  const authSecret = b64urlDecode(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('Neplatný klíč zařízení (p256dh).');
  if (authSecret.length < 16) throw new Error('Neplatný klíč zařízení (auth).');
  if (payload.length > RECORD_SIZE - 17 - 86) throw new Error('Zpráva je moc dlouhá.');

  const ecdh = createECDH('prime256v1');
  if (testing?.asPrivateKey) ecdh.setPrivateKey(testing.asPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const salt = testing?.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  // Jediný (poslední) záznam: zpráva + oddělovač 0x02.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, encrypted]);
}

/** Podpis VAPID (JWT ES256) pro push službu (aud = její adresa bez cesty). */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('Neplatný veřejný klíč VAPID.');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: keys.privateKey,
    x: b64urlEncode(pub.subarray(1, 33)),
    y: b64urlEncode(pub.subarray(33, 65)),
  };
  const key = createPrivateKey({ key: jwk, format: 'jwk' });
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(
    Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject }))
  );
  const signature = cryptoSign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${keys.publicKey}`;
}

/**
 * Push služby prohlížečů - jen sem server posílá (adresa od prohlížeče se
 * ukládá až po kontrole, jinak by šlo server poslat na libovolnou adresu).
 */
export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
  const h = url.hostname.toLowerCase();
  return (
    h === 'fcm.googleapis.com' ||
    h === 'jmt17.google.com' ||
    h === 'updates.push.services.mozilla.com' ||
    h === 'web.push.apple.com' ||
    h.endsWith('.push.apple.com') ||
    h.endsWith('.notify.windows.com')
  );
}

/** Pošle jednu zprávu na jedno zařízení. `gone` = zařízení už oznámení nechce (smazat). */
export async function sendWebPush(
  target: PushTarget,
  payload: object,
  keys: VapidKeys,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string; fetchImpl?: typeof fetch } = {}
): Promise<PushResult> {
  const body = encryptPushPayload(Buffer.from(JSON.stringify(payload), 'utf8'), target);
  const headers: Record<string, string> = {
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(Math.max(0, Math.min(opts.ttl ?? 24 * 3600, 4 * 7 * 24 * 3600))),
    Urgency: opts.urgency ?? 'normal',
    Authorization: vapidAuthorization(target.endpoint, keys),
  };
  // Topic: novější zpráva se stejným tématem nahradí starší, která ještě nedorazila.
  if (opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) headers.Topic = opts.topic;
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(target.endpoint, { method: 'POST', headers, body: new Uint8Array(body), signal: AbortSignal.timeout(10000) });
    // 404/410: zařízení se odhlásilo. 403: podepsané jiným klíčem VAPID (po změně klíčů) - nefunkční.
    const gone = res.status === 404 || res.status === 410 || res.status === 403;
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

/** Klíče z nastavení (Vercel), nebo null, když push není nastavený. */
export function vapidKeysFromEnv(env: Record<string, string | undefined> = process.env): VapidKeys | null {
  const publicKey = String(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY ?? '').trim();
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey)) return null;
  const subject = String(env.VAPID_SUBJECT ?? '').trim() || 'mailto:kinesupport@gmail.com';
  return { publicKey, privateKey, subject };
}
