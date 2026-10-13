/**
 * Režim televize.
 *
 * Kine na televizi = prohlížeč v Smart TV, ovládaný dálkovým ovladačem:
 * šipky, OK, Zpět. Žádná myš, žádný prst, divák sedí tři metry daleko.
 * Režim televize proto dělá tři věci:
 *   1) všechno zvětší (10-foot UI; CSS přes html[data-tv="on"]),
 *   2) šipky ovladače přesouvají výrazně zvýrazněný výběr po stránce
 *      (lib/spatialNav.ts),
 *   3) OK otevře nebo přehraje, Zpět vrátí.
 *
 * Zapíná se sám, když prohlížeč vypadá jako televize (lib/deviceClass.ts).
 * Přepínač v nabídce profilu byl zbytečný (televize se pozná sama), proto
 * zmizel - a s ním i uložená ruční volba, ať nikomu nezůstane zapnutý na
 * počítači. Na vyzkoušení jde pořád adresa ?tv=1 (?tv=0 vypne); platí jen
 * do zavření karty.
 */

import { detectDeviceClass } from './deviceClass';

export const TV_STORAGE_KEY = 'kine-tv';
export const TV_CHANGE_EVENT = 'kine-tv-change';

export type TvPreference = 'on' | 'off' | 'auto';

/** Rozhodnutí bez prohlížeče - kvůli testu. */
export function resolveTvMode(input: { preference: TvPreference; looksLikeTv: boolean; urlParam: string | null }): boolean {
  if (input.urlParam === '1' || input.urlParam === 'on') return true;
  if (input.urlParam === '0' || input.urlParam === 'off') return false;
  if (input.preference === 'on') return true;
  if (input.preference === 'off') return false;
  return input.looksLikeTv;
}

/** Vyzkoušení přes ?tv=1 / ?tv=0 - jen pro tuhle kartu (sessionStorage). */
export function readTvPreference(): TvPreference {
  try {
    const v = sessionStorage.getItem(TV_STORAGE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTvPreference(pref: TvPreference) {
  try {
    if (pref === 'auto') sessionStorage.removeItem(TV_STORAGE_KEY);
    else sessionStorage.setItem(TV_STORAGE_KEY, pref);
  } catch {
    // bez úložiště platí volba jen do obnovení stránky
  }
  applyTvMode();
  try {
    window.dispatchEvent(new Event(TV_CHANGE_EVENT));
  } catch {
    // starý prohlížeč bez Event konstruktoru - nic se neděje
  }
}

/** Je režim televize právě zapnutý? */
export function isTvMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.tv === 'on';
}

/**
 * Spočítá, jestli má být režim zapnutý, a zapíše to na <html>. Parametr
 * ?tv= v adrese se zároveň uloží jako ruční volba, ať platí i po přechodu
 * na další stránku (adresa se tam už nenese).
 */
export function applyTvMode(): boolean {
  if (typeof window === 'undefined') return false;

  let urlParam: string | null = null;
  try {
    // Ruční volba z dřívějšího přepínače v nabídce (trvalá) - už neplatí.
    localStorage.removeItem(TV_STORAGE_KEY);
  } catch {
    // bez úložiště
  }
  try {
    urlParam = new URLSearchParams(window.location.search).get('tv');
    if (urlParam === '1' || urlParam === 'on') sessionStorage.setItem(TV_STORAGE_KEY, 'on');
    if (urlParam === '0' || urlParam === 'off') sessionStorage.setItem(TV_STORAGE_KEY, 'off');
  } catch {
    // bez úložiště
  }

  const on = resolveTvMode({
    preference: readTvPreference(),
    looksLikeTv: detectDeviceClass() === 'tv',
    urlParam,
  });

  if (on) document.documentElement.dataset.tv = 'on';
  else delete document.documentElement.dataset.tv;
  return on;
}
