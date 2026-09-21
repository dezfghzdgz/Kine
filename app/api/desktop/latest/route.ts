import { NextResponse } from 'next/server';
import { fetchLatestRelease, desktopDownloadUrl } from '@/lib/desktopRelease';

/** Verze a datum nejnovější appky do PC - pro stránku /download. */
export const revalidate = 3600;

export async function GET() {
  const release = await fetchLatestRelease();
  return NextResponse.json({ release, downloadUrl: '/download/windows', directUrl: desktopDownloadUrl() });
}
