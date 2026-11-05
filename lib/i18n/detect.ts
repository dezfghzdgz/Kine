/**
 * Jazyk Kine podle jazyka prohlížeče.
 *
 * PROČ
 *
 * Web startoval vždycky anglicky a češtinu si musel každý přepnout ručně.
 * Kdo přišel z české reklamy, viděl anglické Kine. Teď se při první návštěvě
 * vybere jazyk podle prohlížeče (navigator.languages); ruční volba v nabídce
 * má přednost a pamatuje se dál (localStorage 'kine-lang').
 *
 * Čistá funkce: tests/detectLang.test.mjs.
 */
import type { Lang } from '../i18n';

export const SUPPORTED_LANGS: Lang[] = ['cs', 'en', 'de', 'sk', 'es', 'pl', 'fr', 'uk'];

/** Z „cs-CZ“, „sk“, „en-US“… první podporovaný jazyk; jinak angličtina. */
export function detectLang(languages: readonly string[] | null | undefined): Lang {
  for (const raw of languages ?? []) {
    const code = String(raw || '').toLowerCase().split(/[-_]/)[0];
    if ((SUPPORTED_LANGS as string[]).includes(code)) return code as Lang;
  }
  return 'en';
}

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGS as string[]).includes(value);
}
