import { NextResponse } from 'next/server';
import { fetchLatestRelease, desktopDownloadUrl, DESKTOP_DOWNLOAD_BASE } from '@/lib/desktopRelease';

/** Verze a datum nejnovějších appek do PC (Kine, Kine Clipper) - pro stránku /download. */
export const revalidate = 3600;

export async function GET() {
  const [release, clipper] = await Promise.all([fetchLatestRelease('full'), fetchLatestRelease('clipper')]);
  return NextResponse.json({
    release,
    /** Kine Clipper má vlastní vydání (stejná verze, jiný instalátor). */
    clipper,
    downloadUrl: '/download/windows',
    clipperUrl: '/download/windows?variant=clipper',
    directUrl: desktopDownloadUrl('full'),
    clipperDirectUrl: desktopDownloadUrl('clipper'),
    /** Odkud se stahuje: naše úložiště, nebo záložně GitHub. */
    source: DESKTOP_DOWNLOAD_BASE ? 'store' : 'github',
  });
}
