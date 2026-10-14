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

/**
 * Adresa pro API, jehož odpověď bez přihlášení smí chvíli podržet CDN (seznam
 * přenosů, stav kanálu). Nepřihlášený dotaz dostane do adresy "anon=1" -
 * přihlášený (vlastní přenos, odběry, skryté přenosy pro tým Kine) má tak
 * jinou adresu a CDN mu nikdy nepodstrčí odpověď určenou nepřihlášeným.
 */
export function cacheableUrl(url: string, headers: Record<string, string>): string {
  if (headers.Authorization) return url;
  return `${url}${url.includes('?') ? '&' : '?'}anon=1`;
}
