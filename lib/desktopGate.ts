import { NextResponse } from 'next/server';
import { fetchLatestRelease } from './desktopRelease';
import { compareVersions, desktopMinVersion, isOutdatedApp, kineAppFrom, OUTDATED_APP_MESSAGE } from './desktopClient';

/**
 * Zastaralá appka do PC nesmí nahrávat ani vysílat (lib/desktopClient.ts).
 * Volají to cesty, které stojí peníze (nahrání videa, založení vysílání...).
 */

const RELEASE_CACHE_MS = 10 * 60 * 1000;
let releaseCache: { at: number; version: string | null } | null = null;

/** Nejnovější vydaná verze appek (vyšší z Kine a Kine Clipper); null = nevíme. */
export async function latestDesktopVersion(): Promise<string | null> {
  if (releaseCache && Date.now() - releaseCache.at < RELEASE_CACHE_MS) return releaseCache.version;
  let version: string | null = null;
  try {
    const [full, clipper] = await Promise.all([fetchLatestRelease('full'), fetchLatestRelease('clipper')]);
    for (const r of [full, clipper]) {
      if (r?.version && (!version || compareVersions(r.version, version) > 0)) version = r.version;
    }
  } catch {
    version = null;
  }
  releaseCache = { at: Date.now(), version };
  return version;
}

/** Nejstarší verze appky, kterou teď opravdu vyžadujeme (jen když už je vydaná), jinak null. */
export async function enforcedDesktopMinVersion(): Promise<string | null> {
  const min = desktopMinVersion(process.env);
  if (!min) return null;
  const latest = await latestDesktopVersion();
  return latest && compareVersions(latest, min) >= 0 ? min : null;
}

/** Odpověď 426 pro zastaralou appku, jinak null (prohlížeč, aktuální appka). */
export async function outdatedAppResponse(req: Request): Promise<NextResponse | null> {
  const app = kineAppFrom(req.headers);
  if (!app) return null;
  const min = desktopMinVersion(process.env);
  if (!min) return null;
  // Aktuální appka nemusí čekat na zjišťování vydané verze.
  if (!app.legacy && app.version && compareVersions(app.version, min) >= 0) return null;
  const latest = await latestDesktopVersion();
  if (!isOutdatedApp(app, min, latest)) return null;
  return NextResponse.json({ error: OUTDATED_APP_MESSAGE, code: 'update-required', minVersion: min }, { status: 426, headers: { 'Cache-Control': 'no-store' } });
}
