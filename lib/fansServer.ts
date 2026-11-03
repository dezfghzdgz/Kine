import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from './supabaseServer';
import { isMissingTable } from './apiUser';
import { instagramProfileUrl, type FanEntry } from './fans';

/**
 * Zeď fanoušků na serveru (stránka /fans a Admin). Tabulky fan_wall
 * a fan_wall_settings jsou jen pro server (supabase-migration-fans.sql) -
 * z prohlížeče se k nim nikdo nedostane, čte a zapisuje jen service role.
 */

/** Nejvíc jmen na stránce (víc se při kampani hned tak nenasbírá; stránka zůstane rychlá). */
export const WALL_LIMIT = 5000;

type Row = { id: number; handle: string; day: number; created_at: string; profile_id: string | null };

export type FanWall = {
  /** false = migrace ještě neproběhla (tabulka chybí). */
  available: boolean;
  entries: FanEntry[];
  total: number;
  instagramUrl: string | null;
  instagramRaw: string | null;
};

/**
 * Všechna jména (nejnovější první) a nastavení. Propojený účet Kine se ukáže,
 * jen když není zablokovaný ani shadow-banovaný - jinak zůstane holá přezdívka.
 * Chyba databáze = prázdná zeď (stránka nespadne).
 *
 * `client`: stránka /fans bere klienta s mezipamětí (supabaseServerCached -
 * stránka se nevykresluje při každé návštěvě z reklamy znovu, po změně v Adminu
 * ji obnoví revalidatePath); Admin čte vždy čerstvě (supabaseServer).
 */
export async function loadFanWall(client: SupabaseClient = supabaseServer, limit = WALL_LIMIT): Promise<FanWall> {
  const empty: FanWall = { available: true, entries: [], total: 0, instagramUrl: null, instagramRaw: null };
  try {
    const [rowsRes, settingsRes] = await Promise.all([
      client
        .from('fan_wall')
        .select('id, handle, day, created_at, profile_id', { count: 'exact' })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit),
      client.from('fan_wall_settings').select('instagram').eq('id', 1).maybeSingle(),
    ]);
    if (rowsRes.error) return { ...empty, available: !isMissingTable(rowsRes.error) };
    const rows = (rowsRes.data ?? []) as Row[];
    const instagramRaw = settingsRes.error ? null : ((settingsRes.data as { instagram?: string | null } | null)?.instagram ?? null);

    const profileIds = [...new Set(rows.map((r) => r.profile_id).filter((id): id is string => !!id))];
    const profiles = new Map<string, { id: string; username: string }>();
    if (profileIds.length > 0) {
      let res = await client.from('profiles').select('id, username, is_banned, is_shadow_banned').in('id', profileIds);
      if (res.error) res = (await client.from('profiles').select('id, username').in('id', profileIds)) as typeof res;
      for (const p of (res.data ?? []) as { id: string; username: string | null; is_banned?: boolean | null; is_shadow_banned?: boolean | null }[]) {
        if (p.username && !p.is_banned && !p.is_shadow_banned) profiles.set(p.id, { id: p.id, username: p.username });
      }
    }

    return {
      available: true,
      total: rowsRes.count ?? rows.length,
      instagramRaw,
      instagramUrl: instagramProfileUrl(instagramRaw),
      entries: rows.map((r) => ({
        id: r.id,
        handle: r.handle,
        day: r.day,
        createdAt: r.created_at,
        kine: r.profile_id ? profiles.get(r.profile_id) ?? null : null,
      })),
    };
  } catch {
    return empty;
  }
}

/** Den prvního jména (kvůli číslování dnů kampaně); null = zeď je prázdná. */
export async function firstFanAt(): Promise<number | null> {
  const { data } = await supabaseServer.from('fan_wall').select('created_at').order('created_at', { ascending: true }).limit(1);
  const at = Date.parse((data?.[0] as { created_at?: string } | undefined)?.created_at ?? '');
  return Number.isFinite(at) ? at : null;
}
