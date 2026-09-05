import { createClient } from '@supabase/supabase-js';

/**
 * Supabase klient na serveru, který se tváří jako přihlášený uživatel.
 *
 * Servisní klíč (lib/supabaseServer.ts) obchází Row Level Security - hodí
 * se na zápisy, které appka dělá sama. Když ale server potřebuje vědět
 * "smí TENHLE člověk vidět TOHLE video?", nejlepší odpověď dá databáze
 * sama, stejnými pravidly jako v prohlížeči. Přepisovat ta pravidla do
 * kódu by znamenalo mít je dvakrát a jednou zapomenout.
 *
 * Bez tokenu se klient chová jako nepřihlášený návštěvník (anon).
 */
export function supabaseAsUser(accessToken: string | null) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }
  );
}

/** Přihlašovací token z hlavičky Authorization, nebo null. */
export function bearerFrom(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}
