import { NextResponse } from 'next/server';
import { desktopDownloadUrl } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení appky Kine do PC rovnou z Kine: kine.../download/windows pošle
 * prohlížeč na nejnovější instalátor. Ten leží na GitHub Releases
 * (staví ho GitHub Actions v repu kine-desktop), ale uživatel GitHub
 * nevidí - jen mu začne stahování Kine-Setup.exe.
 */
export async function GET() {
  return NextResponse.redirect(desktopDownloadUrl(), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
