import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Tento klient se používá jen na serveru (v API routes), protože
// service role key obchází Row Level Security. NIKDY ho neposílej do prohlížeče.

/**
 * Každé čtení z databáze na serveru čerstvé (cache: 'no-store').
 *
 * PROČ: Next.js 14 si odpovědi na fetch ukládá do své Data Cache - a API cesta,
 * která má jen GET (seznam Živě, stav kanálu, srovnání s Cloudflare...), je
 * podle něj "statická", i s `dynamic = 'force-dynamic'`: dotazy Supabase se
 * uložily NAPOŘÁD (revalidate false) a další požadavky dostávaly první odpověď
 * po nasazení. Proto záložka Živě ukazovala "nikdo nevysílá" (první dotaz přišel,
 * když nikdo nevysílal), zatímco stav kanálu (jiný dotaz, uložený během vysílání)
 * hlásil "živě" - a po konci vysílání ho hlásil dál. Ověřeno pokusem s next start
 * (scratch: cachexp) - druhý a třetí dotaz seznamu na databázi vůbec nedošel.
 */
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });

export const supabaseServer = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  global: { fetch: noStoreFetch },
});

const cachedClients = new Map<number, SupabaseClient>();

/**
 * Jen pro metadata stránek (náhled odkazu a titulek videa / kanálu / přenosu, mapa
 * webu): odpověď se smí podržet `revalidate` vteřin, ať se stránka nevykresluje
 * pokaždé znovu (ISR). Nikdy v API cestách - tam vždy `supabaseServer`.
 */
export function supabaseServerCached(revalidate: number): SupabaseClient {
  const seconds = Math.max(1, Math.round(revalidate));
  let client = cachedClients.get(seconds);
  if (!client) {
    const cachedFetch: typeof fetch = (input, init) => fetch(input, { ...init, next: { revalidate: seconds } });
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      global: { fetch: cachedFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    cachedClients.set(seconds, client);
  }
  return client;
}
