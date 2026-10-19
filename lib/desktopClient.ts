/**
 * Kdo volá API: appka do PC (Kine / Kine Clipper) a v jaké verzi?
 *
 * Appka od verze 0.11.0 posílá hlavičku "X-Kine-App: clipper/0.11.0"
 * (nebo "full/0.11.0" u Kine do PC). Starší verze nic neposílají - poznají
 * se podle toho, že volají z Node.js: User-Agent "node" (fetch v Node.js -
 * undici) a chybí Sec-Fetch-Site, který posílá každý prohlížeč. Pozor:
 * Sec-Fetch-Mode posílá i Node.js, podle něj to rozlišit nejde.
 *
 * K čemu to je: zastaralá appka nesmí nahrávat ani vysílat. Jinak by si
 * kdokoli mohl nechat starou verzi (bez novějších pravidel) a nikdy
 * neaktualizovat. Ohlídá se to, až když je nová verze opravdu venku
 * (jinak by appka hlásila "aktualizuj" a nebylo by na co).
 *
 * DESKTOP_MIN_VERSION (Vercel) = nejstarší verze, která smí nahrávat;
 * výchozí DEFAULT_DESKTOP_MIN_VERSION, "off" = nehlídat.
 *
 * Čistá logika (tests/desktopClient.test.mjs).
 */

export const DEFAULT_DESKTOP_MIN_VERSION = '0.11.0';

export type KineAppInfo = {
  /** full / clipper = appka do PC (Windows, macOS, Linux); android = mobilní Kine Clipper (repo kine-mobile). */
  variant: 'full' | 'clipper' | 'android' | null;
  version: string | null;
  /** Stará appka bez hlavičky (verze neznámá - před 0.11.0). */
  legacy: boolean;
};

type HeaderSource = { get(name: string): string | null };

const APP_HEADER = /^(full|clipper|android)\/(\d{1,4}\.\d{1,4}\.\d{1,4})$/i;

/** Appka do PC nebo do telefonu, nebo null (prohlížeč, cokoli jiného). */
export function kineAppFrom(headers: HeaderSource): KineAppInfo | null {
  const raw = (headers.get('x-kine-app') ?? '').trim();
  const m = APP_HEADER.exec(raw);
  if (m) return { variant: m[1].toLowerCase() as 'full' | 'clipper' | 'android', version: m[2], legacy: false };
  const ua = (headers.get('user-agent') ?? '').trim();
  const browserish = /Mozilla\//.test(ua) || !!headers.get('sec-fetch-site');
  if (!browserish && /^(node|undici)\b/i.test(ua)) return { variant: null, version: null, legacy: true };
  return null;
}

/** Porovná "1.2.3" s "1.10.0" po číslech: záporné = a starší. Nečitelné = 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (/^\d+(\.\d+){0,3}$/.test(v.trim()) ? v.trim().split('.').map(Number) : [0]);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Nejstarší povolená verze appky do PC (null = nehlídá se). */
export function desktopMinVersion(env: Record<string, string | undefined> = {}): string | null {
  const raw = (env.DESKTOP_MIN_VERSION ?? '').trim();
  if (/^(off|0|none|false)$/i.test(raw)) return null;
  if (/^\d+\.\d+\.\d+$/.test(raw)) return raw;
  return DEFAULT_DESKTOP_MIN_VERSION;
}

/** Nejstarší povolená verze mobilní appky (ANDROID_MIN_VERSION ve Vercelu); bez ní se mobil nehlídá. */
export function androidMinVersion(env: Record<string, string | undefined> = {}): string | null {
  const raw = (env.ANDROID_MIN_VERSION ?? '').trim();
  return /^\d+\.\d+\.\d+$/.test(raw) ? raw : null;
}

/**
 * Je appka zastaralá? Jen když požadovaná verze už je vydaná (latestReleased
 * je aspoň `min`) - dokud není na co aktualizovat, nic se neblokuje.
 */
export function isOutdatedApp(app: KineAppInfo | null, min: string | null, latestReleased: string | null): boolean {
  if (!app || !min || !latestReleased) return false;
  if (compareVersions(latestReleased, min) < 0) return false;
  if (app.legacy || !app.version) return true;
  return compareVersions(app.version, min) < 0;
}

export const OUTDATED_APP_MESSAGE =
  'Tahle verze appky je zastaralá. Aktualizuj ji (v appce Nastavení → Aktualizovat, nebo stáhni novou na Kine) a zkus to znovu.';
