/**
 * Kde leží appky do PC a v jaké jsou verzi.
 *
 * Dvě appky z jednoho repa kine-desktop: "Kine" (Kine do PC - Kine jako
 * aplikace + klipovač) a "Kine Clipper" (jen klipovač). Instalátory staví
 * GitHub Actions a nahrává je na dvě místa: do našeho úložiště (Cloudflare
 * R2 - odsud stahují lidi a odsud si nainstalované appky berou
 * aktualizace; každá appka ve své složce full/ a clipper/) a jako zálohu do
 * GitHub Releases.
 *
 * NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE  veřejná adresa úložiště, např.
 *                                    https://pub-xxxx.r2.dev nebo https://stahnout.kine.cz
 *                                    (tam leží full/Kine-Setup.exe, full/latest.yml,
 *                                    clipper/Kine-Clipper-Setup.exe, clipper/latest.yml)
 *                                    - to samé, co je v GitHubu jako proměnná
 *                                    DESKTOP_DOWNLOAD_BASE
 * NEXT_PUBLIC_DESKTOP_REPO           "vlastnik/kine-desktop" na GitHubu (záloha)
 * NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL   přebije všechno - přímá adresa instalátoru Kine
 *                                    (klipovač se hledá vedle něj)
 */
export const DESKTOP_REPO = process.env.NEXT_PUBLIC_DESKTOP_REPO || 'dezfghzdgz/kine-desktop';
export const DESKTOP_DOWNLOAD_BASE = (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE || '').replace(/\/+$/, '');

export type DesktopVariant = 'full' | 'clipper';
/** Systémy, pro které se appka staví (release.yml v repu kine-desktop): Windows (exe), macOS (dmg), Linux (AppImage, deb). */
export type DesktopOs = 'windows' | 'mac' | 'linux' | 'linux-deb';
export const DESKTOP_OSES: DesktopOs[] = ['windows', 'mac', 'linux', 'linux-deb'];

export const DESKTOP_INSTALLER_NAMES: Record<DesktopVariant, string> = {
  full: 'Kine-Setup.exe',
  clipper: 'Kine-Clipper-Setup.exe',
};
export const DESKTOP_INSTALLER_NAME = DESKTOP_INSTALLER_NAMES.full;

/** Soubory podle systému - stejné názvy píše electron-builder (scripts/publish-config.mjs v kine-desktop). */
export const DESKTOP_FILES: Record<DesktopVariant, Record<DesktopOs, string>> = {
  full: { windows: 'Kine-Setup.exe', mac: 'Kine-Mac.dmg', linux: 'Kine-Linux.AppImage', 'linux-deb': 'Kine-Linux.deb' },
  clipper: { windows: 'Kine-Clipper-Setup.exe', mac: 'Kine-Clipper-Mac.dmg', linux: 'Kine-Clipper-Linux.AppImage', 'linux-deb': 'Kine-Clipper-Linux.deb' },
};

/** Názvy appek, jak se ukazují lidem (nelokalizované - takhle se jmenují i po instalaci). */
export const DESKTOP_APP_NAMES: Record<DesktopVariant, string> = { full: 'Kine', clipper: 'Kine Clipper' };

export function isDesktopOs(value: unknown): value is DesktopOs {
  return typeof value === 'string' && (DESKTOP_OSES as string[]).includes(value);
}

/** Systém podle User-Agentu prohlížeče (stránka ke stažení předvybere ten správný). */
export function detectDesktopOs(userAgent: string): DesktopOs {
  const ua = userAgent || '';
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  if (/Linux|X11/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return 'windows';
}

export function desktopDownloadUrl(variant: DesktopVariant = 'full', os: DesktopOs = 'windows'): string {
  const file = DESKTOP_FILES[variant][os] ?? DESKTOP_INSTALLER_NAMES[variant];
  if (process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL) {
    // Ruční adresa míří na jeden soubor - ostatní leží vedle něj.
    return process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL.replace(/[^/]+$/, file);
  }
  if (DESKTOP_DOWNLOAD_BASE) return `${DESKTOP_DOWNLOAD_BASE}/${variant}/${file}`;
  return `https://github.com/${DESKTOP_REPO}/releases/latest/download/${file}`;
}

/** Odkazy ke stažení pro obě appky a všechny systémy (pro /api/desktop/latest a appku). */
export function desktopDownloads(): Record<DesktopVariant, Record<DesktopOs, string>> {
  const forVariant = (variant: DesktopVariant) => Object.fromEntries(DESKTOP_OSES.map((os) => [os, desktopDownloadUrl(variant, os)])) as Record<DesktopOs, string>;
  return { full: forVariant('full'), clipper: forVariant('clipper') };
}

/**
 * Kine Clipper pro Android (repo kine-mobile): APK mimo Google Play. Workflow
 * build.yml ho při každém pushi na main nahraje do „plovoucího“ vydání
 * `android-latest` na GitHubu (soubor Kine-Clipper.apk + latest.json s verzí)
 * a - když jsou v tom repu klíče k R2 - i do našeho úložiště do složky android/.
 *
 * NEXT_PUBLIC_MOBILE_REPO            "vlastnik/kine-mobile" na GitHubu (výchozí zdroj)
 * NEXT_PUBLIC_ANDROID_DOWNLOAD_BASE  složka s APK a latest.json v našem úložišti, např.
 *                                    https://pub-xxxx.r2.dev/android - jen když build.yml
 *                                    v kine-mobile do R2 opravdu nahrává (jinak by odkaz mířil
 *                                    do prázdna; proto se nebere DESKTOP_DOWNLOAD_BASE automaticky)
 * NEXT_PUBLIC_ANDROID_DOWNLOAD_URL   přebije všechno - přímá adresa APK (latest.json se hledá vedle)
 */
export const MOBILE_REPO = process.env.NEXT_PUBLIC_MOBILE_REPO || 'dezfghzdgz/kine-mobile';
export const ANDROID_APK_NAME = 'Kine-Clipper.apk';
export const ANDROID_RELEASE_TAG = 'android-latest';

/** Složka, ve které leží APK i latest.json (bez lomítka na konci). */
export function androidDownloadBase(): string {
  if (process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL) return process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL.replace(/\/[^/]*$/, '');
  const base = (process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_BASE || '').replace(/\/+$/, '');
  if (base) return base;
  return `https://github.com/${MOBILE_REPO}/releases/download/${ANDROID_RELEASE_TAG}`;
}

export function androidDownloadUrl(): string {
  if (process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL) return process.env.NEXT_PUBLIC_ANDROID_DOWNLOAD_URL;
  return `${androidDownloadBase()}/${ANDROID_APK_NAME}`;
}

/** Systém podle User-Agentu včetně telefonu (stránka /download předvybere záložku Android). */
export function detectDownloadOs(userAgent: string): DesktopOs | 'android' {
  if (/Android/i.test(userAgent || '')) return 'android';
  return detectDesktopOs(userAgent);
}

/**
 * Verze APK z latest.json vedle něj (píše ho build.yml v kine-mobile):
 *   { "version": "0.1.0", "versionCode": 1, "publishedAt": "2026-10-19T10:00:00Z", "sizeBytes": 2345678, "file": "Kine-Clipper.apk" }
 * Null, když soubor ještě není (první sestavení neproběhlo) nebo nejde přečíst.
 */
export async function fetchAndroidRelease(): Promise<DesktopRelease | null> {
  try {
    const res = await fetch(`${androidDownloadBase()}/latest.json`, { next: { revalidate: 3600 }, headers: { 'User-Agent': 'kine-web' } });
    if (!res.ok) return null;
    return parseAndroidLatest(await res.text());
  } catch {
    return null;
  }
}

export function parseAndroidLatest(text: string): DesktopRelease | null {
  try {
    const data = JSON.parse(text);
    const version = typeof data?.version === 'string' && data.version.trim() ? data.version.trim() : null;
    if (!version) return null;
    const size = Number(data.sizeBytes);
    return {
      version,
      publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
      sizeBytes: Number.isFinite(size) && size > 0 ? size : null,
    };
  } catch {
    return null;
  }
}

/**
 * Starší rozložení úložiště (do appky 0.4.0): instalátory v kořeni, ne ve
 * složkách full/ a clipper/. Bere se, když nová složka ještě neexistuje
 * (web nasazený dřív než první vydání 0.5.0). Null bez úložiště.
 */
export function legacyDesktopDownloadUrl(variant: DesktopVariant = 'full'): string | null {
  if (!DESKTOP_DOWNLOAD_BASE || process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL) return null;
  return `${DESKTOP_DOWNLOAD_BASE}/${DESKTOP_INSTALLER_NAMES[variant]}`;
}

export type DesktopRelease = { version: string; publishedAt: string | null; sizeBytes: number | null };

/**
 * Nejnovější vydání appky: z latest.yml v našem úložišti (píše ho
 * electron-builder; ve složce appky, u Kine záložně i v kořeni - tam ležel
 * do verze 0.4.0), záložně z GitHubu (veřejné API, bez klíče). Null, když
 * se nepovede.
 */
export async function fetchLatestRelease(variant: DesktopVariant = 'full'): Promise<DesktopRelease | null> {
  if (DESKTOP_DOWNLOAD_BASE) {
    const fromStore = await fetchLatestYml(`${DESKTOP_DOWNLOAD_BASE}/${variant}/latest.yml`);
    if (fromStore) return fromStore;
    if (variant === 'full') {
      const legacy = await fetchLatestYml(`${DESKTOP_DOWNLOAD_BASE}/latest.yml`);
      if (legacy) return legacy;
    }
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kine-web' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const asset = Array.isArray(data.assets) ? data.assets.find((a: any) => a?.name === DESKTOP_INSTALLER_NAMES[variant]) : null;
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

/** Proužek "Kine do PC" na hlavní stránce se po zavření vrátí za týden. */
export const DESKTOP_BANNER_SHOW_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Má proužek zůstat schovaný? `stored` je čas zavření (ms) z localStorage;
 * starší verze ukládala jen "1" - tu volající převede na dnešní čas, tady
 * se bere jako "zavřeno teď".
 */
export function desktopBannerDismissed(stored: string | null, now = Date.now()): boolean {
  if (!stored) return false;
  const at = Number(stored);
  if (!Number.isFinite(at) || at <= 1) return true;
  return now - at < DESKTOP_BANNER_SHOW_AGAIN_MS;
}
