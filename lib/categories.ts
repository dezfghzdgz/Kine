/**
 * Kategorie videí.
 *
 * V databázi se u videa neukládá název kategorie, ale klíč překladu -
 * 'catMusic', ne "Hudba" ani "Music". Díky tomu je kategorie napříč jazyky
 * pořád ta samá věc a filtr v Exploreru funguje, ať si divák přepne jazyk
 * jak chce. Cenou za to je, že se ten klíč nikdy nesmí ukázat divákovi -
 * v technických údajích u videa se dřív ukazoval přesně takhle, syrově.
 *
 * Seznam je tady jeden pro celou appku. Dřív byl zvlášť v nahrávání a
 * zvlášť v levém sloupci a nic nehlídalo, že se ty dva nerozejdou.
 */

export const CATEGORY_KEYS = [
  'catCars', 'catTravel', 'catFilm', 'catGaming', 'catMusic',
  'catComedy', 'catPeople', 'catHowTo', 'catNonprofit', 'catSports',
  'catScience', 'catEducation', 'catEntertainment', 'catNews', 'catPets',
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

const KNOWN = new Set<string>(CATEGORY_KEYS);

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && KNOWN.has(value);
}

/**
 * Název kategorie v jazyce diváka.
 *
 * Když je v databázi něco, co mezi kategorie nepatří (starší video,
 * překlep, ručně upravený řádek), vrátí se to, co tam je - pořád je to
 * lepší než prázdno. Neznámou hodnotu totiž nemá cenu překládat a spadnout
 * na tom kvůli technickému údaji už vůbec ne.
 */
export function categoryLabel(category: string | null | undefined, t: (key: any) => string): string {
  if (!category) return '—';
  return isCategoryKey(category) ? t(category) : category;
}
