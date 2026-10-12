/**
 * Práce na pozadí po odeslání odpovědi (kontrola obsahu videa, snímky
 * z přenosů). Na Vercelu funkce po odpovědi normálně končí - přes
 * waitUntil z kontextu požadavku ji Vercel nechá doběhnout (stejně jako
 * balíček @vercel/functions, jen bez další závislosti). Mimo Vercel
 * (next start, testy) promise prostě běží dál sám.
 */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

export function runInBackground(task: Promise<unknown>, label = 'úloha na pozadí'): void {
  const guarded = task.catch((err) => {
    console.error(`Kine: ${label} selhala`, err instanceof Error ? err.message : err);
  });
  try {
    const context = (globalThis as any)[REQUEST_CONTEXT]?.get?.();
    if (context && typeof context.waitUntil === 'function') context.waitUntil(guarded);
  } catch {
    // Bez kontextu požadavku se jen nečeká - úloha běží dál.
  }
}
