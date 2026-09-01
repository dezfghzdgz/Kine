import { supabase } from './supabaseClient';

/**
 * Načítání dlouhých seznamů.
 *
 * Supabase vrací na jeden dotaz nejvýš tisíc řádků. Neohlásí to chybou -
 * prostě vrátí tisíc a zbytek zahodí, takže se to pozná až tím, že v appce
 * něco chybí. Odsud se to bere po dávkách, dokud databáze nedojde.
 *
 * Druhá past je dotaz `in('id', [...])`: seznam identifikátorů se posílá
 * v adrese. Dvě stě videí znamená adresu přes sedm kilobajtů a některé
 * servery a proxy ji utnou - dotaz pak spadne celý a stránka zůstane
 * prázdná, aniž by kdokoliv věděl proč. Právě proto se Historie, Stažené
 * a Líbí se mi po pár stovkách položek vysypaly.
 */

const PAGE = 1000;
/** Kolik identifikátorů se vejde do jedné adresy, aby zůstala rozumně krátká. */
const ID_CHUNK = 100;

/**
 * Projde všechny stránky dotazu.
 *
 * `build` dostane rozsah a vrátí hotový dotaz. Volá se opakovaně, dokud
 * databáze vrací plné dávky.
 */
export async function fetchAllRows<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  maxRows = 5000
): Promise<T[]> {
  const all: T[] = [];

  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) break;

    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }

  return all;
}

/**
 * Načte řádky podle seznamu identifikátorů, po zvládnutelných dávkách.
 *
 * Pořadí vrácených řádků odpovídá pořadí zadaných identifikátorů - seznamy
 * jako Historie nebo Stažené se řadí podle času z jiné tabulky, takže na
 * pořadí z databáze se spolehnout nedá.
 */
export async function fetchByIds<T extends { id: string }>(
  table: string,
  columns: string,
  ids: string[]
): Promise<T[]> {
  if (ids.length === 0) return [];

  const found = new Map<string, T>();

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await supabase.from(table).select(columns).in('id', chunk);
    if (error) continue;
    for (const row of (data ?? []) as unknown as T[]) found.set(row.id, row);
  }

  return ids.map((id) => found.get(id)).filter((row): row is T => row !== undefined);
}
