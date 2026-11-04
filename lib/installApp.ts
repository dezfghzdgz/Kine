/**
 * Kine jako appka v telefonu - „Přidat na plochu“ (PWA).
 *
 * JAK TO FUNGUJE
 *
 * Web má manifest (app/manifest.ts) a ikony (public/icons). Podle nich
 * telefon pozná, že Kine jde přidat na plochu jako appku: vlastní ikona,
 * celá obrazovka bez lišty prohlížeče, v přepínači aplikací jako „Kine“.
 * Nic se nestahuje z obchodu a appka je pořád nejnovější (je to pořád web).
 *
 *  - Android (Chrome, Edge, Samsung Internet): prohlížeč pošle událost
 *    beforeinstallprompt. Zachytí ji skript v <head> (INSTALL_BOOT_SCRIPT)
 *    a tlačítko „Přidat na plochu“ pak otevře systémové okno „Instalovat“.
 *    Chrome ji ale pošle až po chvíli na webu (aspoň 30 s a jedno klepnutí) -
 *    do té doby se místo okna ukáže krátký návod (nabídka ⋮).
 *  - iPhone / iPad: nainstalovat za člověka nejde nic (Apple to nedovolí),
 *    ukáže se návod Sdílet → Přidat na plochu. Push oznámení fungují na
 *    iPhonu jen v Kine přidaném na plochu.
 *  - Instagram, Facebook, TikTok… (prohlížeč uvnitř appky): odtud na plochu
 *    přidat nejde - návod, jak Kine otevřít v Safari / Chrome.
 *  - Počítač a televize: nic. Na PC je appka Kine do PC.
 *
 * Čisté funkce (bez prohlížeče): tests/installApp.test.mjs.
 */

import { detectDeviceClass, type DeviceClass } from './deviceClass';
import { isInDesktopApp } from './desktopRelease';

export type InstallPlatform = 'installed' | 'in-app' | 'ios' | 'android' | 'other';

export interface InstallSignals {
  userAgent: string;
  /** navigator.platform - iPad s iPadOS se hlásí jako „MacIntel“ s dotykem. */
  platform: string;
  maxTouchPoints: number;
  /** Kine už běží jako appka z plochy (display-mode standalone / navigator.standalone). */
  standalone: boolean;
}

/** Prohlížeče uvnitř jiných appek - odtud na plochu přidat nejde. */
const IN_APP_UA =
  /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|BytedanceWebview|musical_ly|TikTok|Snapchat|LinkedInApp|Pinterest|Twitter|KAKAOTALK|\bLine\/|GSA\/|; wv\)/i;

export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_UA.test(userAgent || '');
}

export function isIOSDevice(s: Pick<InstallSignals, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(s.userAgent || '') || (s.platform === 'MacIntel' && (s.maxTouchPoints ?? 0) > 1);
}

/** Jaký návod / tlačítko dává smysl. Pořadí je důležité: Instagram na iPhonu je „in-app“, ne „ios“. */
export function installPlatform(s: InstallSignals): InstallPlatform {
  if (s.standalone) return 'installed';
  if (isInAppBrowser(s.userAgent)) return 'in-app';
  if (isIOSDevice(s)) return 'ios';
  if (/Android/i.test(s.userAgent || '')) return 'android';
  return 'other';
}

/**
 * Nabízet „Přidat na plochu“? Jen na telefonu a tabletu, a jen tam, kde to
 * jde (nebo kde aspoň poradíme, jak). Na počítači a televizi nikdy.
 */
export function shouldOfferInstall(platform: InstallPlatform, device: DeviceClass): boolean {
  if (device !== 'phone' && device !== 'tablet') return false;
  return platform === 'ios' || platform === 'android' || platform === 'in-app';
}

// ---------------------------------------------------------------------------
// Prohlížeč
// ---------------------------------------------------------------------------

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};

declare global {
  interface Window {
    __kineInstallPrompt?: InstallPromptEvent | null;
  }
}

/** Změna: událost od Chromu dorazila, appka se nainstalovala… (komponenty se přepočítají). */
export const INSTALL_READY_EVENT = 'kine-install-ready';
/** Otevřít návod (components/InstallAppHost.tsx). */
export const INSTALL_OPEN_EVENT = 'kine-install-open';
/** Tenhle prohlížeč už Kine nainstaloval (událost appinstalled) - pruh se neukazuje. */
export const INSTALLED_KEY = 'kine-app-installed';

/**
 * Skript do <head>: událost beforeinstallprompt může přijít dřív, než se
 * načte React (u vracejícího se návštěvníka hned po otevření stránky).
 * Proto se chytá tady a schová se do window.__kineInstallPrompt.
 * preventDefault: Chrome pak nevyskočí s vlastním proužkem přes spodní
 * lištu - nabídku ukáže Kine samo, na Domovské a v nabídce profilu.
 * Událost chodí jen tam, kde appka nainstalovaná NENÍ - smaže se tedy
 * i značka „nainstalováno“ (kdo appku odinstaloval, nabídka se mu vrátí).
 */
export const INSTALL_BOOT_SCRIPT = `(function(){try{var f=function(){try{window.dispatchEvent(new Event('${INSTALL_READY_EVENT}'))}catch(_){}};window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__kineInstallPrompt=e;try{localStorage.removeItem('${INSTALLED_KEY}')}catch(_){}f()});window.addEventListener('appinstalled',function(){window.__kineInstallPrompt=null;try{localStorage.setItem('${INSTALLED_KEY}','1')}catch(_){}f()})}catch(_){}})();`;

function matches(query: string): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function readInstallSignals(): InstallSignals {
  if (typeof window === 'undefined') return { userAgent: '', platform: '', maxTouchPoints: 0, standalone: false };
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent ?? '',
    platform: nav.platform ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone:
      nav.standalone === true ||
      matches('(display-mode: standalone)') ||
      matches('(display-mode: fullscreen)') ||
      matches('(display-mode: minimal-ui)'),
  };
}

export function currentInstallPlatform(): InstallPlatform {
  return installPlatform(readInstallSignals());
}

export function appMarkedInstalled(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Ukázat „Přidat na plochu“ v tomhle prohlížeči? (Ne v okně appky Kine do PC.) */
export function canOfferInstall(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (isInDesktopApp()) return false;
  } catch {
    // nevadí
  }
  return shouldOfferInstall(currentInstallPlatform(), detectDeviceClass());
}

function notify() {
  try {
    window.dispatchEvent(new Event(INSTALL_READY_EVENT));
  } catch {
    // nevadí
  }
}

/**
 * Tlačítko „Přidat na plochu“. Musí se volat přímo z kliknutí - systémové
 * okno Chromu jde otevřít jen hned po klepnutí (proto tu před prompt()
 * nesmí být žádné await).
 *
 *  - 'accepted' / 'dismissed': Android ukázal okno „Instalovat“,
 *  - 'guide': otevřel se návod (iPhone, Instagram, Chrome bez události).
 */
export async function requestInstall(): Promise<'accepted' | 'dismissed' | 'guide'> {
  const ev = typeof window !== 'undefined' ? window.__kineInstallPrompt : null;
  if (ev && typeof ev.prompt === 'function') {
    // Jedna událost = jedno okno. Další pošle Chrome sám, až zase půjde.
    window.__kineInstallPrompt = null;
    try {
      const shown = ev.prompt();
      await shown;
      const choice = await ev.userChoice;
      if (choice?.outcome === 'accepted') {
        try {
          localStorage.setItem(INSTALLED_KEY, '1');
        } catch {
          // nevadí
        }
        notify();
        return 'accepted';
      }
      notify();
      return 'dismissed';
    } catch {
      // Okno nešlo otevřít - ukáže se aspoň návod.
    }
  }
  try {
    window.dispatchEvent(new Event(INSTALL_OPEN_EVENT));
  } catch {
    // nevadí
  }
  return 'guide';
}
