import { NextResponse } from 'next/server';
import { fetchLatestRelease, desktopDownloadUrl, DESKTOP_DOWNLOAD_BASE } from '@/lib/desktopRelease';

/** Verze a datum nejnovější appky do PC - pro stránku /download. */
export const revalidate = 3600;

export async function GET() {
  const release = await fetchLatestRelease();
  return NextResponse.json({
    release,
    downloadUrl: '/download/windows',
    clipperUrl: '/download/windows?variant=clipper',
    directUrl: desktopDownloadUrl('full'),
    /** Odkud se stahuje: naše úložiště, nebo záložně GitHub. */
    source: DESKTOP_DOWNLOAD_BASE ? 'store' : 'github',
  });
}
