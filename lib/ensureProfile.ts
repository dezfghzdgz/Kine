import { validateUsername } from './username';

/**
 * Profil, který při registraci nevznikl.
 *
 * Při registraci se profil zakládá hned - jenže jen když Supabase rovnou
 * přihlásí. Se zapnutým potvrzováním e-mailu (Supabase -> Authentication ->
 * Confirm email) přihlásí až odkaz v e-mailu, a ten vede rovnou na Kine,
 * ne přes přihlašovací stránku. Proto se profil dotvoří tam, kde se na
 * přihlášeného člověka appka ptá vždycky (levé menu, přihlášení, Můj kanál).
 *
 * Jméno: to, které si člověk vybral při registraci (uložené u účtu
 * v user_metadata), jinak user_xxxxxxxx. Nikdy ne z e-mailu - jméno je
 * veřejné a z "jan.novak@firma.cz" by byl vidět kus adresy (a s pomlčkou
 * nebo "+" by ho databáze stejně odmítla a profil by nevznikl vůbec).
 */

type AuthUser = { id: string; user_metadata?: Record<string, unknown> | null };

/** Náhradní jméno z id účtu - vždy projde pravidly (lib/username.ts). */
export function generatedUsername(userId: string): string {
  return `user_${userId.replace(/[^a-f0-9]/gi, '').slice(0, 8).toLowerCase() || 'kine'}`;
}

/** Jména k vyzkoušení: vybrané při registraci (když projde pravidly), pak náhradní. */
export function profileNameCandidates(user: AuthUser): string[] {
  const chosen = typeof user.user_metadata?.username === 'string' ? user.user_metadata.username.trim() : '';
  const fallback = generatedUsername(user.id);
  return chosen && !validateUsername(chosen) && chosen.toLowerCase() !== fallback ? [chosen, fallback] : [fallback];
}

type SupabaseLike = {
  from: (table: string) => any;
};

/**
 * Založí profil (a systémový playlist Sledovat později), když chybí.
 * Vrací true, když profil právě vznikl (appka pak pošle člověka do průvodce /welcome).
 */
export async function ensureOwnProfile(supabase: SupabaseLike, user: AuthUser): Promise<boolean> {
  const { data: existing, error } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (error || existing) return false;
  for (const username of profileNameCandidates(user)) {
    const { error: insertError } = await supabase.from('profiles').insert({ id: user.id, username, display_name: username });
    if (!insertError) {
      await supabase.from('playlists').insert({ owner_id: user.id, title: 'Sledovat později', color: '#3a5a8a', is_system: true });
      return true;
    }
    // Profil mezitím založilo jiné okno / jiná stránka - hotovo.
    if (insertError.code === '23505' && /profiles_pkey/.test(insertError.message ?? '')) return false;
  }
  return false;
}
