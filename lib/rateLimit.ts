/**
 * Brzda požadavků v paměti instance serveru: kolik pokusů za okno na klíč
 * (typicky "akce:uživatel"). Proti zahlcení API jedním účtem nebo skriptem -
 * víc instancí Vercelu ji obejde jen částečně, takže je to pojistka navíc,
 * ne jediná ochrana (limity nahrávání a peněz hlídá databáze).
 */
const hits = new Map<string, number[]>();

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  // Paměť nesmí růst donekonečna.
  if (hits.size > 10000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}

/** Odpověď 429 se srozumitelnou hláškou a Retry-After. */
export function tooManyRequests(seconds = 30): Response {
  return new Response(JSON.stringify({ error: 'Moc rychle - zkus to prosím za chvíli.', code: 'rate' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': String(seconds) },
  });
}
