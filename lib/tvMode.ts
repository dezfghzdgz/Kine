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
 * Zapíná se:
 *   - sám, když prohlížeč vypadá jako televize (lib/deviceClass.ts),
 *   - ručně v nabídce profilu (uloží se),
 *   - adresou ?tv=1 (na vyzkoušení na počítači; ?tv=0 vypne).
 * Ruční volba má přednost před automatikou.
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

export function readTvPreference(): TvPreference {
  try {
    const v = localStorage.getItem(TV_STORAGE_KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTvPreference(pref: TvPreference) {
  try {
    if (pref === 'auto') localStorage.removeItem(TV_STORAGE_KEY);
    else localStorage.setItem(TV_STORAGE_KEY, pref);
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
    urlParam = new URLSearchParams(window.location.search).get('tv');
    if (urlParam === '1' || urlParam === 'on') localStorage.setItem(TV_STORAGE_KEY, 'on');
    if (urlParam === '0' || urlParam === 'off') localStorage.setItem(TV_STORAGE_KEY, 'off');
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
