import { NextRequest, NextResponse } from 'next/server';
import { desktopDownloadUrl, legacyDesktopDownloadUrl, type DesktopVariant } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení appky do PC rovnou z Kine: kine.../download/windows pošle
 * prohlížeč na nejnovější instalátor v našem úložišti (Cloudflare R2;
 * záložně GitHub Releases). Uživatel nikam nechodí - jen mu začne
 * stahování.
 *
 *   /download/windows                 Kine do PC     (full/Kine-Setup.exe)
 *   /download/windows?variant=clipper Kine Clipper   (clipper/Kine-Clipper-Setup.exe)
 *
 * Když složka appky v úložišti ještě není (web nasazený dřív než první
 * vydání 0.5.0), pošle se na starý soubor v kořeni - ať odkaz nikdy
 * nevede na 404. Ověření (HEAD) se pamatuje 5 minut.
 */
async function resolve(variant: DesktopVariant): Promise<string> {
  const primary = desktopDownloadUrl(variant);
  const legacy = legacyDesktopDownloadUrl(variant);
  if (!legacy) return primary;
  try {
    const res = await fetch(primary, { method: 'HEAD', next: { revalidate: 300 } });
    if (res.ok) return primary;
  } catch {
    // úložiště neodpovídá - zkusí se aspoň starý odkaz
  }
  return legacy;
}

export async function GET(req: NextRequest) {
  const variant: DesktopVariant = req.nextUrl.searchParams.get('variant') === 'clipper' ? 'clipper' : 'full';
  return NextResponse.redirect(await resolve(variant), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
