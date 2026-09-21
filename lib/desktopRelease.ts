/**
 * Kde leží appka Kine do PC a v jaké je verzi.
 *
 * Instalátor staví GitHub Actions v repu kine-desktop a nahrává ho na dvě
 * místa: do našeho úložiště (Cloudflare R2 - odsud stahují lidi a odsud si
 * nainstalované appky berou aktualizace) a jako zálohu do GitHub Releases.
 *
 * NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE  veřejná adresa složky v úložišti, např.
 *                                    https://pub-xxxx.r2.dev nebo https://stahnout.kine.cz
 *                                    (tam leží Kine-Setup.exe, Kine-Clipper-Setup.exe,
 *                                    latest.yml) - to samé, co je v GitHubu jako
 *                                    proměnná DESKTOP_DOWNLOAD_BASE
 * NEXT_PUBLIC_DESKTOP_REPO           "vlastnik/kine-desktop" na GitHubu (záloha)
 * NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL   přebije všechno - přímá adresa instalátoru
 *
 * Jeden instalátor, dva názvy: podle názvu si appka při prvním spuštění
 * předvyplní režim ("Kine + klipy" / "jen klipovač").
 */
export const DESKTOP_REPO = process.env.NEXT_PUBLIC_DESKTOP_REPO || 'dezfghzdgz/kine-desktop';
export const DESKTOP_DOWNLOAD_BASE = (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE || '').replace(/\/+$/, '');

export type DesktopVariant = 'full' | 'clipper';

export const DESKTOP_INSTALLER_NAMES: Record<DesktopVariant, string> = {
  full: 'Kine-Setup.exe',
  clipper: 'Kine-Clipper-Setup.exe',
};
export const DESKTOP_INSTALLER_NAME = DESKTOP_INSTALLER_NAMES.full;

export function desktopDownloadUrl(variant: DesktopVariant = 'full'): string {
  const file = DESKTOP_INSTALLER_NAMES[variant];
  if (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL) {
    // Ruční adresa míří na jeden soubor - druhý název leží vedle něj.
    return process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL.replace(/[^/]+$/, file);
  }
  if (DESKTOP_DOWNLOAD_BASE) return `${DESKTOP_DOWNLOAD_BASE}/${file}`;
  return `https://github.com/${DESKTOP_REPO}/releases/latest/download/${file}`;
}

export type DesktopRelease = { version: string; publishedAt: string | null; sizeBytes: number | null };

/**
 * Nejnovější vydání: z latest.yml v našem úložišti (píše ho electron-builder),
 * záložně z GitHubu (veřejné API, bez klíče). Null, když se nepovede.
 */
export async function fetchLatestRelease(): Promise<DesktopRelease | null> {
  if (DESKTOP_DOWNLOAD_BASE) {
    const fromStore = await fetchLatestYml(`${DESKTOP_DOWNLOAD_BASE}/latest.yml`);
    if (fromStore) return fromStore;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kine-web' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const asset = Array.isArray(data.assets) ? data.assets.find((a: any) => a?.name === DESKTOP_INSTALLER_NAME) : null;
    return {
      version: String(data.tag_name ?? data.name ?? '').replace(/^v/, ''),
      publishedAt: data.published_at ?? null,
      sizeBytes: asset?.size ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchLatestYml(url: string): Promise<DesktopRelease | null> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 }, headers: { 'User-Agent': 'kine-web' } });
    if (!res.ok) return null;
    return parseLatestYml(await res.text());
  } catch {
    return null;
  }
}

/**
 * latest.yml od electron-builderu:
 *   version: 0.2.0
 *   files:
 *     - url: Kine-Setup.exe
 *       sha512: …
 *       size: 134217728
 *   path: Kine-Setup.exe
 *   releaseDate: '2026-09-21T18:00:00.000Z'
 */
export function parseLatestYml(text: string): DesktopRelease | null {
  const version = /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  if (!version) return null;
  const size = /^\s+size:\s*(\d+)/m.exec(text)?.[1];
  const date = /^releaseDate:\s*['"]?([^'"\s]+)/m.exec(text)?.[1];
  return { version, publishedAt: date ?? null, sizeBytes: size ? Number(size) : null };
}

/** Běží stránka v okně appky Kine do PC? (appka si do User-Agentu přidává "KineDesktop/verze") */
export function isInDesktopApp(): boolean {
  return typeof navigator !== 'undefined' && /KineDesktop\//.test(navigator.userAgent);
}
