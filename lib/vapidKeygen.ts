/**
 * Nový pár klíčů VAPID pro push oznámení - v prohlížeči správce (Admin ->
 * Push oznámení), přes WebCrypto. Soukromý klíč neprojde serverem ani
 * chatem: ukáže se jen jednou a správce ho vloží rovnou do Vercelu.
 */
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateVapidKeys(subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await subtle.exportKey('raw', pair.publicKey);
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  if (!jwk.d) throw new Error('Klíč se nepodařilo vytvořit.');
  return { publicKey: b64url(raw), privateKey: jwk.d };
}
