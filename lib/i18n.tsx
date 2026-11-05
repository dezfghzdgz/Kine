'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { cs, type DictKey } from './i18n/cs';
import { en } from './i18n/en';
import { detectLang, isLang } from './i18n/detect';

export type Lang = 'cs' | 'en' | 'de' | 'sk' | 'es' | 'pl' | 'fr' | 'uk';

/**
 * Kód jazyka pro formátování dat a čísel.
 *
 * Názvy dnů a měsíců se díky tomu berou přímo z prohlížeče - nemusíme je
 * ručně překládat do osmi jazyků a nikdy se nerozejdou s tím, jak je píše
 * systém.
 */
export const DATE_LOCALES: Record<Lang, string> = {
  cs: 'cs-CZ', en: 'en-US', de: 'de-DE', sk: 'sk-SK',
  es: 'es-ES', pl: 'pl-PL', fr: 'fr-FR', uk: 'uk-UA',
};

export type { DictKey };

/**
 * Slovníky.
 *
 * Dřív byly všech osm jazyků v jednom souboru a šly ke každému návštěvníkovi
 * naráz - ~320 kB zdroje, i když čte česky. Teď jsou čeština a angličtina
 * v hlavním balíku (výchozí a nejčastější) a ostatních šest se stáhne až
 * ve chvíli, kdy si je někdo zvolí. Než dorazí, ukazuje se čeština -
 * zlomek vteřiny, jen při přepnutí.
 */
type Dict = Record<DictKey, string>;

const staticDicts: Partial<Record<Lang, Dict>> = { cs, en };

const loaders: Record<Exclude<Lang, 'cs' | 'en'>, () => Promise<Dict>> = {
  de: () => import('./i18n/de').then((m) => m.de),
  sk: () => import('./i18n/sk').then((m) => m.sk),
  es: () => import('./i18n/es').then((m) => m.es),
  pl: () => import('./i18n/pl').then((m) => m.pl),
  fr: () => import('./i18n/fr').then((m) => m.fr),
  uk: () => import('./i18n/uk').then((m) => m.uk),
};

const LanguageContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey) => string;
}>({
  lang: 'cs',
  setLang: () => {},
  t: (key) => cs[key],
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [loaded, setLoaded] = useState<Partial<Record<Lang, Dict>>>(staticDicts);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem('kine-lang');
    } catch {
      // bez paměti prohlížeče - jazyk podle prohlížeče
    }
    if (isLang(saved)) {
      setLangState(saved);
      return;
    }
    // První návštěva: jazyk podle prohlížeče (lib/i18n/detect.ts). Neukládá se -
    // kdo si jazyk nepřepne ručně, tomu se Kine řídí nastavením prohlížeče dál.
    const detected = detectLang(typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : []);
    if (detected !== 'en') setLangState(detected);
  }, []);

  // Atribut lang na stránce musí odpovídat tomu, co je na ní napsané.
  // Podle něj se řídí čtečky obrazovky (jinak čtou češtinu anglickou
  // výslovností), nabídka překladu v prohlížeči i dělení slov.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Zvolený jazyk mimo hlavní balík se dotáhne; když se mezitím přepne
  // jinam, starší stažení se nezahodí (hodí se při dalším přepnutí), jen
  // nepřepíše aktuální volbu.
  useEffect(() => {
    if (loaded[lang]) return;
    const loader = (loaders as Partial<Record<Lang, () => Promise<Dict>>>)[lang];
    if (!loader) return;
    let zruseno = false;
    loader()
      .then((dict) => {
        if (!zruseno) setLoaded((prev) => (prev[lang] ? prev : { ...prev, [lang]: dict }));
      })
      .catch(() => {
        // Slovník se nestáhl (výpadek sítě) - zůstává čeština, nic nespadne.
      });
    return () => {
      zruseno = true;
    };
  }, [lang, loaded]);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem('kine-lang', l);
    } catch {
      // anonymní okno - volba platí aspoň do zavření stránky
    }
  }

  function t(key: DictKey) {
    return loaded[lang]?.[key] ?? cs[key];
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
