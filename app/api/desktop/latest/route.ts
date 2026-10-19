import { NextResponse } from 'next/server';
import { fetchLatestRelease, fetchAndroidRelease, desktopDownloadUrl, desktopDownloads, androidDownloadUrl, DESKTOP_DOWNLOAD_BASE } from '@/lib/desktopRelease';

/** Verze a datum nejnovějších appek do PC (Kine, Kine Clipper) a Kine Clipperu pro Android - pro stránku /download. */
export const revalidate = 3600;

export async function GET() {
  const [release, clipper, android] = await Promise.all([fetchLatestRelease('full'), fetchLatestRelease('clipper'), fetchAndroidRelease()]);
  return NextResponse.json({
    release,
    /** Kine Clipper má vlastní vydání (stejná verze, jiný instalátor). */
    clipper,
    downloadUrl: '/download/windows',
    clipperUrl: '/download/windows?variant=clipper',
    directUrl: desktopDownloadUrl('full'),
    clipperDirectUrl: desktopDownloadUrl('clipper'),
    /** Odkazy podle systému: downloads.full.mac, downloads.clipper.linux (AppImage), downloads.full['linux-deb']… */
    downloads: desktopDownloads(),
    /** Kine Clipper pro Android (APK mimo Google Play): verze z latest.json vedle APK, null dokud první sestavení není. */
    android: { release: android, url: '/download/android', directUrl: androidDownloadUrl() },
    /** Odkud se stahuje: naše úložiště, nebo záložně GitHub. */
    source: DESKTOP_DOWNLOAD_BASE ? 'store' : 'github',
  });
}
