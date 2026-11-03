/**
 * Odkud smí server sám stahovat obrázky (kontrola obsahu, přenos náhledu
 * chráněného videa) - čistá logika (tests/apiHardening.test.mjs).
 *
 * PROČ: adresa vlastního náhledu videa pochází z prohlížeče. Kontrola v databázi
 * hlídala jen kus cesty ("/storage/v1/object/public/thumbnails/<id>/"), takže
 * prošlo i https://cizi-server/storage/v1/object/public/thumbnails/<id>/x.jpg.
 * Server pak stahoval z cizího serveru (ten mohl kontrole ukázat nevinný obrázek
 * a všem ostatním něco jiného) a bez omezení velikosti. Teď jen:
 *   - veřejné úložiště vlastního projektu Supabase (NEXT_PUBLIC_SUPABASE_URL),
 *   - snímky Cloudflare Stream: videodelivery.net a customer-<kód>.cloudflarestream.com
 *     vlastního účtu (NEXT_PUBLIC_STREAM_CUSTOMER_CODE; bez něj jakýkoli customer-*,
 *     tam se ale dostane jen adresa, kterou poskládal server sám).
 */

type Env = Record<string, string | undefined>;

const PUBLIC_STORAGE_PATH = '/storage/v1/object/public/';

function parse(url: unknown): URL | null {
  if (typeof url !== 'string' || url.length > 2000) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
    return u;
  } catch {
    return null;
  }
}

/** Host vlastního projektu Supabase (z NEXT_PUBLIC_SUPABASE_URL), malými písmeny; null = není nastavený. */
export function supabaseStorageHost(env: Env = process.env): string | null {
  try {
    const host = new URL(String(env.NEXT_PUBLIC_SUPABASE_URL ?? '')).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** Kód zákazníka Cloudflare Stream z nastavení (customer-<kód>.cloudflarestream.com); null = není. */
export function streamCustomerCodeFromEnv(env: Env = process.env): string | null {
  const code = String(env.NEXT_PUBLIC_STREAM_CUSTOMER_CODE ?? '').trim().toLowerCase();
  return /^[a-z0-9]{4,64}$/.test(code) ? code : null;
}

/**
 * Veřejný soubor ve vlastním úložišti Supabase. `bucket` / `folder` zúží
 * cestu (třeba bucket thumbnails, složka <id majitele>/).
 */
export function isOwnStorageUrl(url: unknown, opts: { bucket?: string; folder?: string } = {}, env: Env = process.env): boolean {
  const u = parse(url);
  const host = supabaseStorageHost(env);
  if (!u || !host || u.hostname.toLowerCase() !== host) return false;
  let path: string;
  try {
    path = decodeURIComponent(u.pathname);
  } catch {
    return false;
  }
  if (!path.startsWith(PUBLIC_STORAGE_PATH) || path.includes('/../') || path.includes('\\')) return false;
  const rest = path.slice(PUBLIC_STORAGE_PATH.length);
  if (opts.bucket && !rest.startsWith(`${opts.bucket}/`)) return false;
  if (opts.folder && !rest.startsWith(`${opts.bucket ? `${opts.bucket}/` : ''}${opts.folder.replace(/\/+$/, '')}/`)) return false;
  return true;
}

/** Snímek / náhled z Cloudflare Stream vlastního účtu. */
export function isOwnStreamMediaUrl(url: unknown, env: Env = process.env): boolean {
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  // videodelivery.net a jeho poddomény patří Cloudflare (snímky, přehrávač) - cizí obsah tam není.
  if (host === 'videodelivery.net' || host.endsWith('.videodelivery.net')) return true;
  const m = /^customer-([a-z0-9]+)\.cloudflarestream\.com$/.exec(host);
  if (!m) return false;
  const code = streamCustomerCodeFromEnv(env);
  return !code || m[1] === code;
}

/** Smí si server obrázek z téhle adresy stáhnout? */
export function isFetchableMediaUrl(url: unknown, env: Env = process.env): boolean {
  return isOwnStorageUrl(url, {}, env) || isOwnStreamMediaUrl(url, env);
}

/** Vlastní náhled videa: jen soubor ve složce majitele v bucketu thumbnails (tam ho nahrává appka). */
export function isOwnThumbnailUrl(url: unknown, ownerId: string, env: Env = process.env): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) return false;
  return isOwnStorageUrl(url, { bucket: 'thumbnails', folder: ownerId.toLowerCase() }, env) || isOwnStorageUrl(url, { bucket: 'thumbnails', folder: ownerId }, env);
}
