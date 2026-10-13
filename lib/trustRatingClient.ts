import { supabase } from './supabaseClient';

// Klientská verze výpočtu "Důvěryhodnosti" - stejná logika jako
// lib/trustRating.ts (server verze), jen přes běžného klienta, aby šla
// použít i ze stránek, které neběží na serveru (např. profil kanálu).
//
// RYCHLOST: dřív se pro rating stáhla všechna videa kanálu a pak VŠECHNY
// jejich reakce (tisíce řádků - na každém otevření videa, přes mobilní data
// souběžně s videem) a pro počet reakcí znovu totéž: 4 dotazy za sebou.
// Teď jen počty (HEAD, bez řádků) po hvězdičkách, všechny naráz: jedno kolo.

/** Rating z věku kanálu a průměrného hodnocení (null = zatím žádné reakce). */
export function trustScoreFrom(createdAt: string | null | undefined, avgScore: number | null, now: number = Date.now()): number {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  const ageDays = Number.isFinite(created) ? (now - created) / (1000 * 60 * 60 * 24) : 0;
  const ageScore = Math.min(Math.max(ageDays, 0) / 180, 1);
  const likeRatio = avgScore === null ? 0.9 : (avgScore - 1) / 4;
  return Math.round(Math.min(Math.max(60 + ageScore * 20 + likeRatio * 20, 50), 99));
}

/**
 * Průměr z počtů: byScore[i] = kolik reakcí má i+1 hvězdiček. Reakce bez
 * hvězdiček (starší lajky z doby před hodnocením) se počítají jako 3 - stejně jako dřív.
 */
export function summaryFromCounts(total: number, byScore: readonly number[]): { total: number; avgScore: number | null } {
  const all = Math.max(0, Math.floor(Number(total) || 0));
  if (all === 0) return { total: 0, avgScore: null };
  let counted = 0;
  let sum = 0;
  byScore.slice(0, 5).forEach((n, i) => {
    const c = Math.max(0, Math.floor(Number(n) || 0));
    counted += c;
    sum += c * (i + 1);
  });
  sum += Math.max(0, all - counted) * 3;
  return { total: all, avgScore: sum / Math.max(all, counted) };
}

/** Kolik reakcí mají videa kanálu a jaký je jejich průměr - jen počty, žádné řádky. */
export async function channelReactionSummary(profileId: string): Promise<{ total: number; avgScore: number | null }> {
  const base = () =>
    supabase
      .from('video_reactions')
      .select('video_id, videos!inner(owner_id)', { count: 'exact', head: true })
      .eq('videos.owner_id', profileId);
  const [all, ...byScore] = await Promise.all([base(), ...[1, 2, 3, 4, 5].map((score) => base().eq('score', score))]);
  if (all.error) throw all.error;
  return summaryFromCounts(all.count ?? 0, byScore.map((r) => (r.error ? 0 : r.count ?? 0)));
}

/** Rating i počet reakcí naráz (stránky potřebují obojí - rating se ukáže až od RATING_UNLOCK_THRESHOLD reakcí). */
export async function channelTrust(profileId: string, createdAt: string | null | undefined): Promise<{ score: number; total: number }> {
  const { total, avgScore } = await channelReactionSummary(profileId);
  return { score: trustScoreFrom(createdAt, avgScore), total };
}

export async function computeTrustRatingClient(profileId: string, createdAt: string): Promise<number> {
  return (await channelTrust(profileId, createdAt)).score;
}

// Rating appka ukáže až po 100 reakcích (lajk/dislajk/hvězdičky) na
// videích a Sparks daného tvůrce - do té doby na to jednoduše není
// dost dat, aby to bylo vypovídající.
export async function getTotalReactionCount(profileId: string): Promise<number> {
  return (await channelReactionSummary(profileId)).total;
}

export const RATING_UNLOCK_THRESHOLD = 100;

// Uloží denní snímek ratingu (jen jednou za den na uživatele) - slouží
// pro graf historie na Statistikách kanálu. Volá se jen pro vlastní profil.
// Zároveň porovná s posledním záznamem a pokud rating klesl, upozorní tvůrce.
export async function recordTrustRatingSnapshot(profileId: string, score: number) {
  const { data: lastSnapshot } = await supabase
    .from('trust_rating_snapshots')
    .select('score, recorded_date')
    .eq('profile_id', profileId)
    .order('recorded_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);

  if (lastSnapshot && lastSnapshot.recorded_date !== today && score < lastSnapshot.score) {
    await supabase.from('notifications').insert({
      user_id: profileId,
      message: `Tvůj rating klesl na ${score}% (bylo ${lastSnapshot.score}%).`,
      link: '/channel-stats',
    });
  }

  await supabase.from('trust_rating_snapshots').upsert(
    { profile_id: profileId, score, recorded_date: today },
    { onConflict: 'profile_id,recorded_date' }
  );
}
