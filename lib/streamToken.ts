import { createSign } from 'node:crypto';

/**
 * Podepsané adresy Cloudflare Stream - jen serverová část.
 *
 * PROČ
 *
 * Soukromé video a video jen pro odběratele hlídá databáze (RLS): kdo nemá
 * právo, řádek nedostane. Jenže samotné video hraje z Cloudflare a stačí
 * mu id (cloudflare_video_id). Kdo ho jednou viděl - odběratel, který
 * potom odběr zrušil, kamarád s odkazem na iframe - ho může pouštět dál a
 * komukoliv ho poslat. Ochrana tedy končila u seznamu, ne u videa.
 *
 * S podepsanými adresami Cloudflare bez platného tokenu video nevydá.
 * Token vystavuje jen Kine (tady), na pár hodin, a jen tomu, komu
 * databáze video ukáže. To je ta stejná hranice, kterou má YouTube u
 * soukromých videí a Netflix u všeho.
 *
 * CO JE TOKEN
 *
 * JWT podepsaný klíčem RS256 (RSA + SHA-256), který Cloudflare vydá k účtu
 * a zná jeho veřejnou půlku. Hlavička {alg, kid}, tělo {sub: id videa,
 * kid, exp, nbf, downloadable}. V adrese přehrávače pak token nahradí id:
 *   https://iframe.videodelivery.net/<TOKEN>?...
 *
 * NASTAVENÍ (lib/streamProtection.ts má celý postup i vypnutí)
 *
 *   CLOUDFLARE_STREAM_KEY_ID   id podpisového klíče
 *   CLOUDFLARE_STREAM_KEY_PEM  soukromý klíč - přesně tak, jak ho Cloudflare
 *                              vrátí (base64 PEM); přijme se i holý PEM
 *
 * Bez těch dvou proměnných se nic nepodepisuje a appka se chová jako dřív.
 */

export type SigningKey = {
  id: string;
  /** PEM soukromého klíče (-----BEGIN ... PRIVATE KEY-----). */
  pem: string;
};

/** Jak dlouho platí token na přehrávání. Stránka videa si po vypršení
 *  neříká o nový - kdo koukal 4 hodiny v kuse, video už měl načtené. */
export const PLAYBACK_TOKEN_TTL_S = 4 * 60 * 60;
/** Token na stažení MP4 - klik a stáhnout, hodina bohatě stačí. */
export const DOWNLOAD_TOKEN_TTL_S = 60 * 60;
/** Krátký token, kterým si server sám stáhne náhledový obrázek. */
export const SERVER_FETCH_TOKEN_TTL_S = 5 * 60;

/** Odpustí hodinám serveru drobný předběh - token "z budoucnosti" by Cloudflare odmítl. */
const NOT_BEFORE_SLACK_S = 60;

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Klíč z hodnoty proměnné prostředí. Cloudflare vrací PEM zakódovaný
 * base64 (aby se vešel na jeden řádek); kdo ho dekóduje sám a vloží holý
 * PEM, má to taky správně.
 */
export function parseSigningKey(id: string | undefined, pemOrBase64: string | undefined): SigningKey | null {
  const keyId = id?.trim();
  const raw = pemOrBase64?.trim();
  if (!keyId || !raw) return null;

  if (raw.includes('-----BEGIN')) return { id: keyId, pem: raw.replace(/\\n/g, '\n') };

  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  if (!decoded.includes('-----BEGIN')) return null;
  return { id: keyId, pem: decoded };
}

export function signingKeyFromEnv(env: Record<string, string | undefined> = process.env): SigningKey | null {
  return parseSigningKey(env.CLOUDFLARE_STREAM_KEY_ID, env.CLOUDFLARE_STREAM_KEY_PEM);
}

export type TokenOptions = {
  /** Platnost v sekundách od `now`. */
  ttlSeconds: number;
  /** Token smí i stáhnout MP4 (/downloads/default.mp4). */
  downloadable?: boolean;
  /** Teď, v milisekundách - kvůli testům. */
  now?: number;
};

/** Podepsaný token pro jedno video. Vrací JWT (tři části oddělené tečkou). */
export function createStreamToken(key: SigningKey, videoUid: string, options: TokenOptions): string {
  if (!videoUid) throw new Error('createStreamToken: chybí id videa');
  if (!Number.isFinite(options.ttlSeconds) || options.ttlSeconds <= 0) {
    throw new Error('createStreamToken: platnost musí být kladná');
  }

  const nowS = Math.floor((options.now ?? Date.now()) / 1000);
  const header = { alg: 'RS256', kid: key.id };
  const payload: Record<string, unknown> = {
    sub: videoUid,
    kid: key.id,
    exp: nowS + Math.floor(options.ttlSeconds),
    nbf: nowS - NOT_BEFORE_SLACK_S,
  };
  if (options.downloadable) payload.downloadable = true;

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(key.pem);
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * V adrese Cloudflare (přehrávač, náhled, stažení) vymění první kus cesty -
 * tam sedí id videa nebo token - za jiný. Zbytek (cesta, parametry) zůstává.
 *
 *   https://customer-x.cloudflarestream.com/<ID>/thumbnails/thumbnail.jpg?time=1s
 *   -> https://customer-x.cloudflarestream.com/<TOKEN>/thumbnails/thumbnail.jpg?time=1s
 */
export function swapPlaybackId(url: string, newId: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/');
  // parts[0] je prázdný (cesta začíná lomítkem), parts[1] je id/token.
  if (parts.length < 2 || !parts[1]) return null;
  parts[1] = newId;
  parsed.pathname = parts.join('/');
  return parsed.toString();
}

/** Je to adresa z Cloudflare Stream (ne vlastní náhled z úložiště Kine)? */
export function isCloudflareStreamUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'videodelivery.net' || host.endsWith('.videodelivery.net') || host.endsWith('.cloudflarestream.com');
  } catch {
    return false;
  }
}
