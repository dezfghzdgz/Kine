'use client';

import { DATE_LOCALES, type Lang } from './i18n';

/**
 * Počet videí ve správném tvaru.
 *
 * Čeština, slovenština, polština i ukrajinština mají tři tvary množného
 * čísla - 1 video, 2 videa, 5 videí. Jeden pevný tvar by v nich vypadal
 * jako chyba ("1 videí"), takže se správný tvar vybírá podle pravidel
 * daného jazyka, která zná přímo prohlížeč.
 */
export function videoCountLabel(count: number, lang: Lang, t: (key: any) => string): string {
  let rule: Intl.LDMLPluralRule = 'other';
  try {
    rule = new Intl.PluralRules(DATE_LOCALES[lang]).select(count);
  } catch {
    // Kdyby prohlížeč pravidla neznal, sáhneme po obecném tvaru.
  }

  const key =
    rule === 'one' ? 'videosCountOne' :
    rule === 'few' ? 'videosCountFew' :
    'videosCountMany';

  return t(key).replace('{count}', String(count));
}
