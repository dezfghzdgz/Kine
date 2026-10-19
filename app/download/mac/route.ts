import { NextRequest, NextResponse } from 'next/server';
import { desktopDownloadUrl, type DesktopVariant } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení appky pro macOS rovnou z Kine (dmg; zatím bez podpisu Apple - viz stránka
 * /download). Zvlášť pro Apple Silicon (M1-M4, výchozí) a Intel (?chip=intel) -
 * prohlížeč čip neprozradí, tak si člověk vybere na stránce.
 *
 *   /download/mac                           Kine do PC    (full/Kine-Mac-arm64.dmg)
 *   /download/mac?chip=intel                Kine do PC    (full/Kine-Mac-x64.dmg)
 *   /download/mac?variant=clipper           Kine Clipper  (clipper/Kine-Clipper-Mac-arm64.dmg)
 */
export async function GET(req: NextRequest) {
  const variant: DesktopVariant = req.nextUrl.searchParams.get('variant') === 'clipper' ? 'clipper' : 'full';
  const os = req.nextUrl.searchParams.get('chip') === 'intel' ? 'mac-intel' : 'mac';
  return NextResponse.redirect(desktopDownloadUrl(variant, os), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
