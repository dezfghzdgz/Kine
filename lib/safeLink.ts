/**
 * Odkaz, který smí appka otevřít z oznámení (a jiných uložených dat):
 * jen stránka Kine - "/" nebo "/neco...".
 *
 * "//nekde.jinde" i "/\nekde.jinde" začínají lomítkem, ale prohlížeč je
 * otevře jako cizí web. Tabulátor a konec řádku prohlížeč z adresy vyhodí,
 * takže "/<tab>/nekde.jinde" je totéž co "//nekde.jinde". Proto: za prvním
 * lomítkem musí být písmeno, číslice, "-" nebo "_" a nikde v adrese žádné
 * mezery, řídicí znaky ani zpětná lomítka. Stejné pravidlo hlídá databáze
 * (supabase-migration-bezpecnost-rijen.sql).
 */
export function safeInternalLink(link: string | null | undefined): string | null {
  if (typeof link !== 'string' || link.length === 0 || link.length > 500) return null;
  return /^\/(?:[A-Za-z0-9_-][^\s\\\u0000-\u001f\u007f]*)?$/.test(link) ? link : null;
}
