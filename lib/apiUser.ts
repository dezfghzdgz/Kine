import { supabaseServer } from './supabaseServer';

/**
 * Přihlášený uživatel podle tokenu v hlavičce Authorization (stejně jako
 * ostatní API cesty), nebo null. Servisní klient token ověří u Supabase.
 */
export async function userFromRequest(req: Request): Promise<{ id: string } | null> {
  const header = req.headers.get('authorization');
  const token = header?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await supabaseServer.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/**
 * Patří uživatel k týmu Kine - moderátor, správce (role), nebo správce webu
 * (is_admin, stránky /admin)? Jen na to, co smí VIDĚT (skryté přenosy
 * s popiskem proč); mazání a zásahy se řídí rolí. Chyba databáze = ne.
 */
export async function isStaffUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const full = await supabaseServer.from('profiles').select('role, is_admin').eq('id', userId).maybeSingle();
  let data = full.data as { role?: string | null; is_admin?: boolean | null } | null;
  if (full.error) data = ((await supabaseServer.from('profiles').select('role').eq('id', userId).maybeSingle()).data as any) ?? null;
  return data?.role === 'moderator' || data?.role === 'admin' || data?.is_admin === true;
}

/** Chybí tabulka (migrace ještě neproběhla)? Postgres 42P01, PostgREST PGRST205. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '');
}
