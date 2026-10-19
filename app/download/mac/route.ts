import { NextRequest, NextResponse } from 'next/server';
import { desktopDownloadUrl, type DesktopVariant } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení appky pro macOS rovnou z Kine (dmg, univerzální pro Intel i Apple
 * Silicon; zatím bez podpisu Apple - viz stránka /download).
 *
 *   /download/mac                 Kine do PC    (full/Kine-Mac.dmg)
 *   /download/mac?variant=clipper Kine Clipper  (clipper/Kine-Clipper-Mac.dmg)
 */
export async function GET(req: NextRequest) {
  const variant: DesktopVariant = req.nextUrl.searchParams.get('variant') === 'clipper' ? 'clipper' : 'full';
  return NextResponse.redirect(desktopDownloadUrl(variant, 'mac'), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
