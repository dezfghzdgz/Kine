import { supabase } from './supabaseClient';

/**
 * Hlavička s přihlášením pro vlastní API (Authorization: Bearer ...), nebo
 * nic, když přihlášený nikdo není. Session se bere z paměti prohlížeče -
 * žádný dotaz na server navíc.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
