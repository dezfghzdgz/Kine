import { isFetchableMediaUrl } from './mediaHosts';

/**
 * Stažení obrázku serverem (kontrola obsahu, přenos náhledu chráněného videa
 * do úložiště) - jen z vlastního úložiště Supabase nebo z Cloudflare Stream
 * vlastního účtu (lib/mediaHosts.ts), s časovým limitem a stropem velikosti.
 * Přesměrování se projde jen na povolené adresy (každé se ověří znovu).
 *
 * Dřív se stahovalo, co přišlo v adrese vlastního náhledu - i z cizího serveru
 * (ten mohl kontrole ukázat jiný obrázek než divákům) a bez omezení velikosti.
 */

/** Největší obrázek, který si server stáhne (snímek z Cloudflare má desítky kB, vlastní náhled pár MB). */
export const MEDIA_MAX_BYTES = 6 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export type FetchedMedia = { bytes: Uint8Array; contentType: string };

/** null = nepovolená adresa, chyba, moc velké, nebo vypršel čas. */
export async function fetchMediaImage(url: string, opts: { maxBytes?: number; timeoutMs?: number } = {}): Promise<FetchedMedia | null> {
  const maxBytes = opts.maxBytes ?? MEDIA_MAX_BYTES;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isFetchableMediaUrl(target)) return null;
    let res: Response;
    try {
      res = await fetch(target, { cache: 'no-store', redirect: 'manual', signal: deadline });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) return null;
      try {
        target = new URL(location, target).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          return null;
        }
        chunks.push(value);
      }
    } catch {
      return null;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, contentType: res.headers.get('content-type') ?? '' };
  }
  return null;
}
