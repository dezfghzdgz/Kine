import { NextRequest, NextResponse } from 'next/server';
import { desktopDownloadUrl, type DesktopVariant } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení appky pro Linux rovnou z Kine: AppImage (jeden soubor, aktualizuje
 * se sám), nebo deb (Ubuntu / Mint / Debian) s ?format=deb.
 *
 *   /download/linux                           Kine do PC    (full/Kine-Linux.AppImage)
 *   /download/linux?format=deb                Kine do PC    (full/Kine-Linux.deb)
 *   /download/linux?variant=clipper           Kine Clipper  (clipper/Kine-Clipper-Linux.AppImage)
 */
export async function GET(req: NextRequest) {
  const variant: DesktopVariant = req.nextUrl.searchParams.get('variant') === 'clipper' ? 'clipper' : 'full';
  const os = req.nextUrl.searchParams.get('format') === 'deb' ? 'linux-deb' : 'linux';
  return NextResponse.redirect(desktopDownloadUrl(variant, os), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
