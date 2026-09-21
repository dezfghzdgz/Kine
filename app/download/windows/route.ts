import { NextRequest, NextResponse } from 'next/server';
import { desktopDownloadUrl } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení appky Kine do PC rovnou z Kine: kine.../download/windows pošle
 * prohlížeč na nejnovější instalátor v našem úložišti (Cloudflare R2;
 * záložně GitHub Releases). Uživatel nikam nechodí - jen mu začne
 * stahování.
 *
 *   /download/windows                 Kine + klipy   (Kine-Setup.exe)
 *   /download/windows?variant=clipper jen klipovač   (Kine-Clipper-Setup.exe)
 */
export async function GET(req: NextRequest) {
  const variant = req.nextUrl.searchParams.get('variant') === 'clipper' ? 'clipper' : 'full';
  return NextResponse.redirect(desktopDownloadUrl(variant), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
