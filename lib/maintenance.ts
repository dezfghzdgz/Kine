import { supabaseServer } from './supabaseServer';

/**
 * Denní údržba databáze (funkce z supabase-migration-doporucovani-vykon.sql),
 * pouští ji /api/videos/sweep při důkladném úklidu:
 *  - kvalita videí pro doporučování (videos.engagement - dokoukanost a hodnocení),
 *  - úklid osobních údajů: IP adresy u zhlédnutí po 30 dnech pryč, hlášení
 *    chyb po 30 dnech, IP adresy pokusů o přihlášení po 2 dnech.
 * Bez migrace funkce neexistují - pak se tiše nestane nic.
 */
export async function sweepMaintenance(): Promise<{ engagement: number | null; pruned: Record<string, number> | null }> {
  const [engagement, pruned] = await Promise.all([
    supabaseServer.rpc('refresh_video_engagement', { p_days: 60 }).then(
      (r) => (r.error ? null : Number(r.data ?? 0)),
      () => null
    ),
    supabaseServer.rpc('kine_prune_logs').then(
      (r) => (r.error || !r.data || typeof r.data !== 'object' ? null : (r.data as Record<string, number>)),
      () => null
    ),
  ]);
  return { engagement, pruned };
}
