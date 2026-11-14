import { isCloudflareUid, streamApiUrl } from './cloudflareVideos';
import { discordVideoEligible } from './discordEmbed';

/**
 * MP4 krátkého veřejného videa pro náhled odkazu (Discord přehraje video
 * rovnou v chatu jen z obyčejného souboru - lib/discordEmbed.ts).
 *
 * Cloudflare Stream MP4 sám nevyrobí, musí se o něj požádat (POST
 * .../downloads). Vyrobený soubor úložiště nestojí nic; platí se jen,
 * když si ho někdo přehraje (jako přehrání v přehrávači). Žádá se:
 *  - po dokončení zpracování krátkého veřejného videa (markVideoReady),
 *  - a pojistkou při sestavení náhledu odkazu, když MP4 ještě není
 *    (starší videa) - ten náhled ho ještě nemá, další už ano.
 *
 * Neveřejná videa sem nepatří: jejich MP4 by bez podepsaného tokenu
 * nešlo (lib/streamProtection.ts) a náhled odkazu je stejně neukazuje.
 */

type Mp4State = { status: 'ready'; url: string } | { status: 'processing' | 'missing' | 'unknown' };

function credentials(): { accountId: string; apiToken: string } | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  return accountId && apiToken ? { accountId, apiToken } : null;
}

async function readMp4(uid: string): Promise<Mp4State> {
  const creds = credentials();
  if (!creds || !isCloudflareUid(uid)) return { status: 'unknown' };
  try {
    // Stránka videa se vykresluje při každé návštěvě - odpověď Cloudflare se drží 5 minut
    // v datové cache (sdílené všemi instancemi), ať se API neptá každý divák.
    const res = await fetch(streamApiUrl(creds.accountId, `/${encodeURIComponent(uid)}/downloads`), {
      headers: { Authorization: `Bearer ${creds.apiToken}` },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) return { status: 'missing' };
    const data = await res.json().catch(() => null);
    if (!data?.success) return { status: 'unknown' };
    const mp4 = data.result?.default;
    if (!mp4) return { status: 'missing' };
    if (mp4.status === 'ready' && typeof mp4.url === 'string' && mp4.url.startsWith('https://')) return { status: 'ready', url: mp4.url };
    return { status: 'processing' };
  } catch {
    return { status: 'unknown' };
  }
}

/** Kdy se o MP4 kterého videa naposledy žádalo (pojistka v paměti instance - žádost stačí jedna). */
const requested = new Map<string, number>();
const REQUEST_GAP_MS = 15 * 60 * 1000;

function shouldRequest(uid: string, now = Date.now()): boolean {
  const last = requested.get(uid);
  if (last && now - last < REQUEST_GAP_MS) return false;
  requested.set(uid, now);
  if (requested.size > 5000) for (const [k, at] of requested) if (now - at >= REQUEST_GAP_MS) requested.delete(k);
  return true;
}

/** Požádá Cloudflare o MP4 (hotové je za chvíli). Chyby se jen zapíšou - náhled odkazu bez videa nevadí. */
export async function requestStreamMp4(uid: string): Promise<void> {
  const creds = credentials();
  if (!creds || !isCloudflareUid(uid)) return;
  try {
    const res = await fetch(streamApiUrl(creds.accountId, `/${encodeURIComponent(uid)}/downloads`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.apiToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.error('Kine: MP4 pro náhled odkazu - Cloudflare odmítl', res.status);
  } catch (e: any) {
    console.error('Kine: MP4 pro náhled odkazu se nepodařilo vyžádat', e?.message ?? e);
  }
}

/**
 * Adresa hotového MP4 pro náhled odkazu, nebo null (dlouhé video, MP4 se
 * teprve dělá, Cloudflare nejde). Chybějící MP4 se rovnou vyžádá.
 * Ptá se jen metadata stránky videa (ISR - nejvýš jednou za 5 min) a JSON
 * pro Discord (cache 2-10 min), ne každý divák.
 */
export async function embedMp4(uid: string | null, durationSeconds: number | null): Promise<string | null> {
  if (!uid || !discordVideoEligible(durationSeconds)) return null;
  const state = await readMp4(uid);
  if (state.status === 'ready') return state.url;
  // Chybí (starší video, nebo se zveřejnilo až po zpracování): požádat - nejvýš jednou za 15 min.
  if (state.status === 'missing' && shouldRequest(uid)) await requestStreamMp4(uid);
  return null;
}
