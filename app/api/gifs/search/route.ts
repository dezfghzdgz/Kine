import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { isTrustedImageHost } from '@/lib/trustedMedia';

export const dynamic = 'force-dynamic';

/**
 * Hledání GIFů pro appku do PC (Kine Clipper - překryvy v úpravách klipu):
 * stejný zdroj jako GIFy v chatu a komentářích na Kine (Giphy), ale přes
 * server - klíč Giphy zůstává tady (GIPHY_API_KEY, záložně
 * NEXT_PUBLIC_GIPHY_API_KEY), appka ho neveze s sebou. Jen pro přihlášené
 * (Bearer token jako ostatní API appky), nejvýš 60 hledání za minutu na účet.
 *
 *   GET /api/gifs/search?q=hype&offset=0   (bez q = trendy)
 *   -> { gifs: [{ id, title, preview: { url, width, height }, full: { url, width, height, size } }], attribution: 'GIPHY' }
 *
 * Vrací jen adresy z media.giphy.com (lib/trustedMedia.ts) - appka si GIF
 * stáhne a položí do klipu.
 */
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || process.env.NEXT_PUBLIC_GIPHY_API_KEY || '';
const LIMIT = 24;
const PER_MINUTE = 60;
const recent = new Map<string, number[]>();

function tooMany(userId: string): boolean {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(userId, list);
  if (recent.size > 5000) for (const [k, v] of recent) if (v.every((t) => now - t >= 60_000)) recent.delete(k);
  return list.length > PER_MINUTE;
}

type GiphyImage = { url?: string; width?: string; height?: string; size?: string };
type GiphyGif = { id?: string; title?: string; images?: Record<string, GiphyImage | undefined> };

function giphyUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /giphy\.com$/.test(u.host.toLowerCase()) && isTrustedImageHost(u.host) ? url : null;
  } catch {
    return null;
  }
}

function pick(img: GiphyImage | undefined) {
  if (!img?.url || !giphyUrl(img.url)) return null;
  return { url: img.url, width: Number(img.width) || 0, height: Number(img.height) || 0, size: Number(img.size) || 0 };
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  if (tooMany(userData.user.id)) return NextResponse.json({ error: 'Pomaleji :) Nejvýš 60 hledání za minutu.' }, { status: 429 });
  if (!GIPHY_API_KEY) return NextResponse.json({ error: 'Hledání GIFů není nastavené (GIPHY_API_KEY).' }, { status: 503 });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const offset = Math.max(0, Math.min(200, Number(req.nextUrl.searchParams.get('offset')) || 0));
  const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: String(LIMIT), offset: String(offset), rating: 'pg-13' });
  if (q) params.set('q', q);
  const endpoint = `https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}?${params}`;
  let res: Response;
  try {
    res = await fetch(endpoint, { signal: AbortSignal.timeout(10_000), next: { revalidate: 60 } });
  } catch {
    return NextResponse.json({ error: 'Giphy teď neodpovídá - zkus to za chvíli.' }, { status: 502 });
  }
  if (!res.ok) return NextResponse.json({ error: `Giphy odpovědělo ${res.status}.` }, { status: 502 });
  const data = (await res.json().catch(() => ({}))) as { data?: GiphyGif[] };
  const gifs = (Array.isArray(data.data) ? data.data : [])
    .map((g) => {
      const preview = pick(g.images?.fixed_width_small) ?? pick(g.images?.fixed_width);
      // Do klipu: celý GIF, ale ne přes 15 MB (ffmpeg ho smyčkuje po celou dobu klipu).
      const full = pick(g.images?.original) ?? pick(g.images?.fixed_width);
      if (!g.id || !preview || !full || full.size > 15 * 1024 * 1024) return null;
      return { id: String(g.id), title: String(g.title ?? '').slice(0, 120), preview, full };
    })
    .filter((g): g is NonNullable<typeof g> => !!g);
  return NextResponse.json({ gifs, attribution: 'GIPHY' }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
