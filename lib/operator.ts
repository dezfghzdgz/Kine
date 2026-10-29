/**
 * Provozovatel Kine - údaje, které zákon chce vidět na webu podnikatele
 * (občanský zákoník § 435: jméno, sídlo / místo podnikání, IČO). Jsou ve
 * Vercelu, ne v repu (repo je veřejné): NEXT_PUBLIC_OPERATOR_NAME,
 * NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS (po změně Redeploy).
 * Výchozí zápis „fyzická osoba podnikající, zapsaná v živnostenském
 * rejstříku“ (živnostník); u firmy (s.r.o.) se dá přepsat přes
 * NEXT_PUBLIC_OPERATOR_REGISTRY, např. „zapsaná v obchodním rejstříku
 * u Městského soudu v Praze, oddíl C, vložka 123456“.
 * Bez jména se řádek neukáže (texty zůstanou jako dřív). Malý modul zvlášť,
 * ať stránka /plus netahá všechny právní texty. Test: tests/plusCheckout.test.mjs.
 */
export type LegalOperator = { name: string; ico: string; address: string; registry?: string };

export const LEGAL_OPERATOR: LegalOperator = {
  name: (process.env.NEXT_PUBLIC_OPERATOR_NAME ?? '').trim(),
  ico: (process.env.NEXT_PUBLIC_OPERATOR_ICO ?? '').trim(),
  address: (process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '').trim(),
  registry: (process.env.NEXT_PUBLIC_OPERATOR_REGISTRY ?? '').trim(),
};

/** „Provozovatel: Jan Novák, IČO 12345678, místo podnikání …“ - null bez jména. */
export function operatorLine(lang: 'cs' | 'en', op: LegalOperator = LEGAL_OPERATOR): string | null {
  if (!op.name) return null;
  const parts = [op.name];
  if (op.ico) parts.push(lang === 'cs' ? `IČO ${op.ico}` : `ID No. (IČO) ${op.ico}`);
  if (op.address) parts.push(lang === 'cs' ? `místo podnikání ${op.address}` : `registered office ${op.address}`);
  const registry = (op.registry ?? '').trim().replace(/\.+$/, '');
  return lang === 'cs'
    ? `Provozovatel: ${parts.join(', ')} - ${registry || 'fyzická osoba podnikající, zapsaná v živnostenském rejstříku'}.`
    : `Operator: ${parts.join(', ')} - ${registry || 'sole trader registered in the Czech Trade Register'}.`;
}
