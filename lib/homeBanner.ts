/**
 * Jeden pruh nahoře na Domovské - nikdy tři pod sebou.
 *
 *  - Nepřihlášený návštěvník (třeba z reklamy na Instagramu): uvítání
 *    „Vítej na Kine“ s tlačítkem Založit účet (components/GuestWelcome.tsx).
 *  - Přihlášený na telefonu: „Kine jako appka v telefonu“ - přidat na plochu
 *    (components/InstallAppBanner.tsx).
 *  - Jinak (počítač): „Kine a klipy“ - appky do PC (components/DesktopAppBanner.tsx;
 *    na telefonu ho schová CSS).
 *
 * Každý pruh jde zavřít křížkem; prohlížeč si pamatuje kdy a pruh se vrátí
 * až po pár dnech. Zavřený pruh neuvolní místo jinému - po zavření je
 * nahoře do příští návštěvy klid.
 *
 * Čisté funkce: tests/homeBanner.test.mjs.
 */

export const GUEST_WELCOME_KEY = 'kine-guest-welcome-dismissed';
export const GUEST_WELCOME_DAYS = 14;
export const INSTALL_BANNER_KEY = 'kine-install-banner-dismissed';
export const INSTALL_BANNER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Zavřel to někdo před méně než `days` dny? (uložený čas v ms; nesmysl = nezavřeno). */
export function dismissedRecently(stored: string | null | undefined, now: number, days: number): boolean {
  if (!stored) return false;
  const at = Number(stored);
  if (!Number.isFinite(at) || at <= 0) return false;
  // Čas z budoucnosti (přenastavené hodiny) se nepočítá jako „navždy“.
  if (at > now + DAY_MS) return false;
  return now - at < days * DAY_MS;
}

export type HomeBannerKind = 'guest' | 'install' | 'desktop';

export function pickHomeBanner(s: {
  signedIn: boolean;
  guestDismissed: boolean;
  offerInstall: boolean;
  installDismissed: boolean;
  installed: boolean;
}): HomeBannerKind {
  if (!s.signedIn) return s.guestDismissed ? 'desktop' : 'guest';
  if (s.offerInstall && !s.installDismissed && !s.installed) return 'install';
  return 'desktop';
}

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeNow(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // anonymní okno - pruh se zavře aspoň teď
  }
}
