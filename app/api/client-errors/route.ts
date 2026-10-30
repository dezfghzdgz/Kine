import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { sanitizeDeviceClass } from '@/lib/deviceClass';
import { MAX_MESSAGE, MAX_STACK, MAX_URL } from '@/lib/errorReporter';
import { allowRequest } from '@/lib/rateLimit';
import { createHash } from 'node:crypto';

/**
 * Přijímá chyby z prohlížeče (lib/errorReporter.ts) a ukládá je do
 * client_errors. Přehled je na /admin/errors.
 *
 * Endpoint je veřejný - chyba se stane i odhlášenému návštěvníkovi - a
 * proto nevěří ničemu, co přijde: bere jen známé sloupce a každý zkrátí.
 *
 * Strop proti zaplavení: od jednoho prohlížeče (stejný user agent) se
 * uloží nejvíc PER_CLIENT_PER_MINUTE hlášení za minutu. IP adresa se
 * schválně nikam neukládá, takže se počítá podle user agenta - pro účel
 * "ať jeden rozbitý prohlížeč nezaplní tabulku" to stačí. Prohlížeč sám
 * navíc posílá nejvíc 10 hlášení na jedno načtení stránky.
 *
 * User agent si ale skript může měnit, proto navíc (jen v paměti serveru,
 * nikam se neukládá): nejvýš PER_IP_PER_MINUTE hlášení z jedné adresy
 * (otisk IP), celkový strop GLOBAL_PER_MINUTE na instanci a nejvýš 32 kB
 * na jedno hlášení - tabulku tak nejde zaplavit (místo v databázi = peníze).
 *
 * Odpovídá vždycky 204, i když se zápis nepovede: prohlížeč, který právě
 * hlásí chybu, nemá co dělat s další chybou od nás.
 */

const PER_CLIENT_PER_MINUTE = 30;
const PER_IP_PER_MINUTE = 20;
const GLOBAL_PER_MINUTE = 600;
const MAX_BODY_BYTES = 32 * 1024;

/** Krátký otisk IP adresy (jen klíč do paměti brzdy - adresa se nikam neukládá). */
function ipKey(req: NextRequest): string {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return createHash('sha256').update(ip).digest('base64url').slice(0, 16);
}
// perf = pomalé video (lib/vodPlayer.ts - reportSlowVideo): statistiky přehrávání místo zásobníku.
const ALLOWED_KINDS = new Set(['error', 'rejection', 'perf']);

function cut(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export async function POST(req: NextRequest) {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
  if (!allowRequest(`client-errors:${ipKey(req)}`, PER_IP_PER_MINUTE, 60_000)) return new NextResponse(null, { status: 204 });
  if (!allowRequest('client-errors:all', GLOBAL_PER_MINUTE, 60_000)) return new NextResponse(null, { status: 204 });
  let data: any;
  try {
    // sendBeacon posílá Blob s application/json, fetch posílá JSON - obojí
    // přečte text() a JSON.parse.
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });
    data = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const message = cut(data?.message, MAX_MESSAGE);
  const fingerprint = cut(data?.fingerprint, 200);
  const kind = ALLOWED_KINDS.has(data?.kind) ? data.kind : null;
  if (!message || !fingerprint || !kind) return new NextResponse(null, { status: 204 });

  const userAgent = cut(data?.userAgent, 300) ?? 'unknown';
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabaseServer
    .from('client_errors')
    .select('id', { count: 'exact', head: true })
    .eq('user_agent', userAgent)
    .gte('created_at', minuteAgo);

  if ((count ?? 0) >= PER_CLIENT_PER_MINUTE) return new NextResponse(null, { status: 204 });

  await supabaseServer.from('client_errors').insert({
    kind,
    message,
    stack: cut(data?.stack, MAX_STACK),
    url: cut(data?.url, MAX_URL),
    user_agent: userAgent,
    device: sanitizeDeviceClass(data?.device),
    fingerprint,
  });

  return new NextResponse(null, { status: 204 });
}
