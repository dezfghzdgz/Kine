import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseServer } from '@/lib/supabaseServer';
import { markVideoReady } from '@/lib/markVideoReady';

/**
 * Cloudflare se ozve, až je video zpracované.
 *
 * PROČ TO TU JE
 *
 * Video se do databáze zapíše se stavem "processing" a na "ready" ho
 * přepne teprve někdo, kdo se Cloudflare zeptá. Ptát se chodil jenom
 * prohlížeč, a jen chvíli po nahrání - dvanáctiminutové video se za tu
 * dobu nezpracuje, dotazování skončilo a video zůstalo navždy
 * "processing". Na Cloudflare bylo v pořádku, na Kine nikde.
 *
 * Tohle je ta spolehlivá cesta: Cloudflare se ozve sám, ať už má tvůrce
 * prohlížeč otevřený nebo ne, ať už mezitím zavřel kartu nebo vypnul
 * počítač.
 *
 * NASTAVENÍ (jednorázově)
 *
 * 1. Vercel -> Settings -> Environment Variables:
 *      CLOUDFLARE_WEBHOOK_SECRET = (tajemství z kroku 2)
 *
 * 2. Přihlásit webhook u Cloudflare (jednou, z příkazové řádky):
 *      curl -X PUT \
 *        "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/webhook" \
 *        -H "Authorization: Bearer <API_TOKEN>" \
 *        -H "Content-Type: application/json" \
 *        --data '{"notificationUrl":"https://kine-lac.vercel.app/api/videos/cloudflare-webhook"}'
 *
 *    V odpovědi přijde "secret" - ten patří do proměnné z kroku 1.
 *
 * Bez nastavení tenhle endpoint jen odmítne všechno, co přijde, a appka
 * se spolehne na doptávání (které se prodloužilo a opakuje se). Nic se
 * tím nerozbije, jen to bude pomalejší.
 */

/**
 * Ověří podpis.
 *
 * Bez toho by kdokoliv mohl poslat "video XY je hotové" a rozeslat tím
 * oznámení všem odběratelům cizího kanálu.
 *
 * Cloudflare podepisuje řetězec "<čas>.<tělo požadavku>" pomocí
 * HMAC-SHA256 a posílá ho v hlavičce Webhook-Signature ve tvaru
 * "time=1230811200,sig1=<hex>".
 */
function podpisSedi(hlavicka: string | null, telo: string, tajemstvi: string): boolean {
  if (!hlavicka) return false;

  const casti = Object.fromEntries(
    hlavicka.split(',').map((kus) => {
      const [klic, ...zbytek] = kus.trim().split('=');
      return [klic, zbytek.join('=')];
    })
  );

  const cas = casti.time;
  const podpis = casti.sig1;
  if (!cas || !podpis) return false;

  // Starý podpis se odmítne, aby se odchycená zpráva nedala poslat znovu
  // za týden. Pět minut je s rezervou na rozdíl hodin mezi servery.
  const stariSekund = Math.abs(Date.now() / 1000 - Number(cas));
  if (!Number.isFinite(stariSekund) || stariSekund > 300) return false;

  const ocekavany = createHmac('sha256', tajemstvi).update(`${cas}.${telo}`).digest('hex');

  const a = Buffer.from(ocekavany, 'utf8');
  const b = Buffer.from(podpis, 'utf8');
  if (a.length !== b.length) return false;
  // Porovnání s pevnou dobou běhu - obyčejné === prozradí útočníkovi
  // podle rychlosti, kolik znaků uhodl.
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const tajemstvi = process.env.CLOUDFLARE_WEBHOOK_SECRET;
  if (!tajemstvi) {
    return NextResponse.json({ error: 'Webhook není nastavený.' }, { status: 503 });
  }

  // Tělo se musí číst jako text: podpis se počítá přesně z toho, co
  // přišlo, včetně mezer a konců řádků.
  const telo = await req.text();

  if (!podpisSedi(req.headers.get('webhook-signature'), telo, tajemstvi)) {
    return NextResponse.json({ error: 'Neplatný podpis.' }, { status: 401 });
  }

  let data: any;
  try {
    data = JSON.parse(telo);
  } catch {
    return NextResponse.json({ error: 'Nečitelné tělo.' }, { status: 400 });
  }

  const cloudflareId = data?.uid;
  if (!cloudflareId) return NextResponse.json({ ok: true });

  // Cloudflare hlásí i mezistavy - zajímá nás jen "hotovo".
  if (!data.readyToStream && data?.status?.state !== 'ready') {
    return NextResponse.json({ ok: true });
  }

  const { data: video } = await supabaseServer
    .from('videos')
    .select('id')
    .eq('cloudflare_video_id', cloudflareId)
    .maybeSingle();

  // Video, které v naší databázi není (třeba se nahrávalo a tvůrce to
  // nedokončil), není důvod hlásit jako chybu - Cloudflare by to jinak
  // zkoušel posílat dokola.
  if (!video) return NextResponse.json({ ok: true });

  await markVideoReady(video.id, data);

  return NextResponse.json({ ok: true });
}
