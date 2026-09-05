import { supabaseServer } from './supabaseServer';
import {
  createStreamToken,
  isCloudflareStreamUrl,
  signingKeyFromEnv,
  swapPlaybackId,
  SERVER_FETCH_TOKEN_TTL_S,
} from './streamToken';

/**
 * Ochrana neveřejných videí podepsanými adresami - serverová část.
 *
 * Co se děje (jen když je nastavený podpisový klíč, viz níž):
 *
 *  1. Video, které není veřejné (soukromé, jen pro odběratele), dostane u
 *     Cloudflare "requireSignedURLs" - bez platného tokenu ho Cloudflare
 *     nevydá nikomu, ani tomu, kdo zná jeho id. Veřejné video se hraje
 *     jako dřív, jen podle id.
 *  2. Token na přehrávání vystavuje /api/videos/playback-token - jen tomu,
 *     komu databáze video ukáže (stejná pravidla jako všude: majitel,
 *     odběratel u videa pro odběratele, spolutvůrce). Platí 4 hodiny.
 *  3. Náhledový obrázek z Cloudflare by pod ochranou taky přestal jít.
 *     Proto se pro chráněné video jednou stáhne a uloží do úložiště Kine
 *     (stejné místo, kam se dávají vlastní náhledy) - odtud ho vidí každý,
 *     komu databáze řádek ukáže, a nic nevyprší.
 *
 * Kdy se sem volá: po nahrání (confirm), po dokončení zpracování
 * (markVideoReady), po uložení úprav videa (/api/videos/protect) a při
 * vrácení viditelnosti po potvrzení spolutvůrce (respond-collab).
 *
 * =====================================================================
 * NASTAVENÍ (jednorázově, ~10 minut)
 * =====================================================================
 *
 * 1. Vytvoř podpisový klíč (jen přes API, v dashboardu není):
 *
 *      curl -X POST \
 *        "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/keys" \
 *        -H "Authorization: Bearer <CLOUDFLARE_STREAM_API_TOKEN>"
 *
 *    V odpovědi je "id" a "pem" (dlouhý řetězec base64). Cloudflare ho
 *    ukáže JEN TEĎ - ulož si ho.
 *
 * 2. Vercel -> Settings -> Environment Variables (Production i Preview):
 *      CLOUDFLARE_STREAM_KEY_ID  = to "id"
 *      CLOUDFLARE_STREAM_KEY_PEM = to "pem" (celý řetězec, tak jak je)
 *    Pak Redeploy.
 *
 * 3. Supabase -> SQL Editor: supabase-migration-podepsane-adresy.sql
 *    (sloupec, ve kterém si Kine pamatuje, které video už je chráněné).
 *
 * 4. Otevři svoje soukromé video -> Upravit -> Uložit. Tím se ochrana
 *    zapne. Zkontroluj: video hraje tobě; a v anonymním okně adresa
 *    https://iframe.videodelivery.net/<cloudflare_video_id> hlásí chybu.
 *    Videa, kterých se to týká, projdi takhle jedno po druhém (nebo je
 *    jednou přepni na veřejné a zpět).
 *
 * VYPNUTÍ / KDYBY SE NĚCO ROZBILO
 *
 *  - Smaž obě proměnné na Vercelu a Redeploy: nic nového se už nepodepíše
 *    ani nechrání. Videa, která už chráněná JSOU, ale zůstanou chráněná
 *    (Cloudflare si to pamatuje) a bez tokenu nepůjdou. Proto je NAPŘED
 *    přepni na veřejné a ulož (tím se ochrana u Cloudflare vypne), a
 *    teprve potom mazej proměnné. Nebo ručně:
 *
 *      curl -X POST \
 *        "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/<VIDEO_ID>" \
 *        -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
 *        --data '{"requireSignedURLs": false}'
 *
 *  - Klíč se dá kdykoliv zrušit: DELETE .../stream/keys/<KEY_ID>. Všechny
 *    tokeny z něj přestanou platit okamžitě.
 */

export type ProtectionSync = {
  outcome: 'not-configured' | 'not-found' | 'unchanged' | 'protected' | 'opened' | 'failed';
  detail?: string;
  thumbnail?: 'copied' | 'kept' | 'failed' | 'not-needed';
};

/** Jsou nastavené všechny tři věci, které to potřebuje? */
export function protectionConfigured(): boolean {
  return !!signingKeyFromEnv() && !!process.env.CLOUDFLARE_ACCOUNT_ID && !!process.env.CLOUDFLARE_STREAM_API_TOKEN;
}

/** Které video má být chráněné: každé, co není veřejné. */
export function shouldBeProtected(visibility: string | null | undefined): boolean {
  return !!visibility && visibility !== 'public';
}

const THUMBNAIL_BUCKET = 'thumbnails';

async function setRequireSignedUrls(cloudflareVideoId: string, on: boolean): Promise<{ ok: boolean; detail?: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${cloudflareVideoId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireSignedURLs: on }),
      }
    );
    const data = await res.json().catch(() => ({ success: false }));
    if (!data.success) {
      return { ok: false, detail: JSON.stringify(data.errors ?? res.status) };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? 'fetch failed' };
  }
}

/**
 * Náhled z Cloudflare přenese do úložiště Kine, ať nezávisí na tokenu.
 * Vrací novou adresu, nebo null, když se to nepovedlo (video třeba ještě
 * náhled nemá) - zkusí se to znovu při dalším volání.
 */
async function copyThumbnailToStorage(video: {
  id: string;
  owner_id: string;
  cloudflare_video_id: string;
  thumbnail_url: string;
}): Promise<string | null> {
  const key = signingKeyFromEnv();
  if (!key) return null;

  const token = createStreamToken(key, video.cloudflare_video_id, { ttlSeconds: SERVER_FETCH_TOKEN_TTL_S });
  const src = swapPlaybackId(video.thumbnail_url, token);
  if (!src) return null;

  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) return null;

    const path = `${video.owner_id}/${video.id}-auto.jpg`;
    const { error } = await supabaseServer.storage
      .from(THUMBNAIL_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;

    const { data } = supabaseServer.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path);
    return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
  } catch {
    return null;
  }
}

/**
 * Srovná ochranu jednoho videa s jeho viditelností. Dá se volat kolikrát
 * chceš - když už všechno sedí, nic nedělá.
 */
export async function syncVideoProtection(videoId: string): Promise<ProtectionSync> {
  if (!protectionConfigured()) return { outcome: 'not-configured' };

  const { data: video } = await supabaseServer
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .maybeSingle();

  if (!video || !video.cloudflare_video_id) return { outcome: 'not-found' };

  const desired = shouldBeProtected(video.visibility);
  // signed_urls je z migrace supabase-migration-podepsane-adresy.sql. Když
  // sloupec chybí (undefined), stav se nezná a Cloudflare se nastaví vždy -
  // je to jen jeden dotaz navíc.
  const known: boolean | null = typeof video.signed_urls === 'boolean' ? video.signed_urls : null;

  let outcome: ProtectionSync['outcome'] = 'unchanged';
  if (known !== desired) {
    const result = await setRequireSignedUrls(video.cloudflare_video_id, desired);
    if (!result.ok) return { outcome: 'failed', detail: result.detail };
    // Když sloupec chybí, update spadne - a nevadí, příště se zeptáme znovu.
    await supabaseServer.from('videos').update({ signed_urls: desired }).eq('id', videoId);
    outcome = desired ? 'protected' : 'opened';
  }

  // Náhled: chráněné video s náhledem přímo z Cloudflare by ho ztratilo.
  let thumbnail: ProtectionSync['thumbnail'] = 'not-needed';
  if (desired && !video.custom_thumbnail && isCloudflareStreamUrl(video.thumbnail_url)) {
    const copied = await copyThumbnailToStorage(video);
    if (copied) {
      await supabaseServer.from('videos').update({ thumbnail_url: copied }).eq('id', videoId);
      thumbnail = 'copied';
    } else {
      thumbnail = 'failed';
    }
  } else if (desired) {
    thumbnail = 'kept';
  }

  return { outcome, thumbnail };
}
