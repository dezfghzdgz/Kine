/**
 * Kde leží appka Kine do PC.
 *
 * NEXT_PUBLIC_DESKTOP_REPO      "vlastnik/kine-desktop" na GitHubu (výchozí níž)
 * NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL  přebije všechno - přímá adresa instalátoru,
 *                                   až bude třeba jiné místo než GitHub
 *
 * GitHub má stálou adresu "releases/latest/download/<soubor>", která vždy
 * míří na nejnovější vydání - proto se instalátor jmenuje pořád stejně
 * (Kine-Setup.exe, viz electron-builder.yml v kine-desktop).
 */
export const DESKTOP_REPO = process.env.NEXT_PUBLIC_DESKTOP_REPO || 'dezfghzdgz/kine-desktop';
export const DESKTOP_INSTALLER_NAME = 'Kine-Setup.exe';

export function desktopDownloadUrl(): string {
  return process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL || `https://github.com/${DESKTOP_REPO}/releases/latest/download/${DESKTOP_INSTALLER_NAME}`;
}

export type DesktopRelease = { version: string; publishedAt: string | null; sizeBytes: number | null };

/** Nejnovější vydání z GitHubu (veřejné API, bez klíče). Null, když se nepovede. */
export async function fetchLatestRelease(): Promise<DesktopRelease | null> {
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
