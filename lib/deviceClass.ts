/**
 * Na čem se Kine právě používá: telefon, tablet, počítač nebo televize.
 *
 * PROČ
 *
 * Nevěděli jsme, jestli se Kine sleduje spíš na mobilu nebo na počítači,
 * a podle toho se rozhoduje, kterému zařízení dát přednost. Odteď se třída
 * zařízení ukládá ke každému zhlédnutí (views_log.device) a k hlášeným
 * chybám (client_errors.device).
 *
 * JAK
 *
 * Ne podle jména prohlížeče, ale podle toho, jak se zařízení chová:
 * hrubý ukazatel (prst, ovladač) a velikost obrazovky. Televize se pozná
 * jen podle prohlížeče - jiný spolehlivý znak nemá. Hodnoty jsou přesně
 * čtyři, aby se daly v databázi sečíst.
 *
 * Čisté, bez prohlížeče: tests/deviceClass.test.mjs.
 */

export const DEVICE_CLASSES = ['phone', 'tablet', 'desktop', 'tv'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Kratší strana obrazovky v CSS px, pod kterou je dotykové zařízení telefon. */
export const PHONE_MAX_SHORT_SIDE = 600;

const TV_UA =
  /smart-?tv|tizen|web0s|webos|netcast|bravia|hbbtv|viera|roku|apple ?tv|google ?tv|android tv|crkey|aft[a-z]{1,3}\b|philipstv|sonydtv|nettv|opera tv|vidaa|whaletv|kddi/i;

export interface DeviceSignals {
  /** (pointer: coarse) - prst nebo ovladač, ne myš. */
  coarse: boolean;
  width: number;
  height: number;
  userAgent: string;
}

export function deviceClass(s: DeviceSignals): DeviceClass {
  if (TV_UA.test(s.userAgent || '')) return 'tv';
  if (s.coarse) {
    const shortSide = Math.min(s.width || 0, s.height || 0);
    return shortSide > 0 && shortSide < PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet';
  }
  return 'desktop';
}

/** Hodnota z prohlížeče. Když se něco nepovede, je to 'desktop', ne pád. */
export function detectDeviceClass(): DeviceClass {
  try {
    if (typeof window === 'undefined') return 'desktop';
    return deviceClass({
      coarse: typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
      width: window.screen?.width ?? window.innerWidth,
      height: window.screen?.height ?? window.innerHeight,
      userAgent: navigator.userAgent ?? '',
    });
  } catch {
    return 'desktop';
  }
}

/** Server: přijme jen jednu ze čtyř hodnot, cokoliv jiného se zahodí. */
export function sanitizeDeviceClass(value: unknown): DeviceClass | null {
  return typeof value === 'string' && (DEVICE_CLASSES as readonly string[]).includes(value)
    ? (value as DeviceClass)
    : null;
}
