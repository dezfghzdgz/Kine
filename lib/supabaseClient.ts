import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Tento klient se používá v komponentách, které běží v prohlížeči.
// Používá "anon key", což je bezpečné mít veřejně viditelné -
// skutečná ochrana dat se řeší přes Row Level Security v Supabase.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Jak často se přihlášení opravdu ověří u Supabase (na pozadí, nikdo na to nečeká). */
export const AUTH_VALIDATE_EVERY_MS = 5 * 60 * 1000;

/**
 * "Kdo jsem" bez čekání na síť.
 *
 * supabase.auth.getUser() se při každém zavolání ptá serveru Supabase
 * (GET /auth/v1/user) - a volá ho skoro každá komponenta: stránka, menu,
 * zvoneček, tlačítko odběru, lajky, komentáře... Na stránce videa tak
 * odcházelo i deset dotazů na přihlášení a každá komponenta čekala na ten
 * svůj, než si vůbec řekla o data. Na mobilních datech to byly vteřiny.
 *
 * Teď getUser() bez parametru vrátí uživatele z uloženého přihlášení
 * (stejně jako getSession - bez sítě; prošlý token se obnoví sám) a
 * opravdové ověření u Supabase proběhne na pozadí, nejvýš jednou za
 * AUTH_VALIDATE_EVERY_MS. Když Supabase řekne, že přihlášení už neplatí
 * (účet smazaný, odhlášený jinde), prohlížeč se odhlásí i tady.
 *
 * Bezpečnost se tím nemění: data chrání RLS v databázi a API na serveru
 * ověřuje token samo (lib/apiUser.ts) - tohle je jen "komu ukázat jeho
 * tlačítka". getUser(jwt) s tokenem jde dál na server jako dřív.
 */
if (typeof window !== 'undefined') {
  const auth = supabase.auth;
  const networkGetUser = auth.getUser.bind(auth);
  let validatedAt = 0;
  let validating: Promise<void> | null = null;

  const validateInBackground = (): void => {
    if (validating || Date.now() - validatedAt < AUTH_VALIDATE_EVERY_MS) return;
    validating = networkGetUser()
      .then((res) => {
        const status = Number((res.error as { status?: number } | null)?.status ?? 0);
        if (!res.error) {
          validatedAt = Date.now();
          return;
        }
        // Bez sítě nebo výpadek Supabase (žádný stav, 5xx): nic - zkusí se to příště.
        if (status === 401 || status === 403) {
          validatedAt = Date.now();
          void auth.signOut({ scope: 'local' });
        }
      })
      .catch(() => {
        // Síť: zkusí se to při dalším getUser().
      })
      .finally(() => {
        validating = null;
      });
  };

  auth.getUser = (async (jwt?: string) => {
    if (jwt) return networkGetUser(jwt);
    const { data, error } = await auth.getSession();
    const session = data?.session ?? null;
    // Bez přihlášení: původní getUser vrátí "nepřihlášen" sám, bez dotazu na server.
    if (error || !session?.user) return networkGetUser();
    validateInBackground();
    return { data: { user: session.user }, error: null };
  }) as typeof auth.getUser;
}
