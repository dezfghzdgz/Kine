import { NextResponse } from 'next/server';
import { androidDownloadUrl } from '@/lib/desktopRelease';

export const dynamic = 'force-dynamic';

/**
 * Stažení Kine Clipperu pro Android rovnou z Kine: APK mimo Google Play.
 *
 *   /download/android   ->  android/Kine-Clipper.apk v našem úložišti, nebo záložně
 *                           vydání `android-latest` v repu kine-mobile na GitHubu
 */
export async function GET() {
  return NextResponse.redirect(androidDownloadUrl(), { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
