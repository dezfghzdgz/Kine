import { supabase } from './supabaseClient';

// Klientská verze výpočtu "Důvěryhodnosti" - stejná logika jako
// lib/trustRating.ts (server verze), jen přes běžného klienta, aby šla
// použít i ze stránek, které neběží na serveru (např. profil kanálu).
export async function computeTrustRatingClient(profileId: string, createdAt: string): Promise<number> {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const ageScore = Math.min(ageDays / 180, 1);

  const { data: videos } = await supabase.from('videos').select('id').eq('owner_id', profileId);
  const videoIds = (videos ?? []).map((v) => v.id);

  let likeRatio = 0.9;
  if (videoIds.length > 0) {
    const { data: reactions } = await supabase.from('video_reactions').select('score').in('video_id', videoIds);
    if (reactions && reactions.length > 0) {
      const avg = reactions.reduce((sum, r) => sum + (r.score ?? 3), 0) / reactions.length;
      likeRatio = (avg - 1) / 4;
    }
  }

  return Math.round(Math.min(Math.max(60 + ageScore * 20 + likeRatio * 20, 50), 99));
}

// Rating appka ukáže až po 100 reakcích (lajk/dislajk/hvězdičky) na
// videích a Sparks daného tvůrce - do té doby na to jednoduše není
// dost dat, aby to bylo vypovídající.
export async function getTotalReactionCount(profileId: string): Promise<number> {
  const { data: videos } = await supabase.from('videos').select('id').eq('owner_id', profileId);
  const videoIds = (videos ?? []).map((v) => v.id);
  if (videoIds.length === 0) return 0;

  const { count } = await supabase
    .from('video_reactions')
    .select('*', { count: 'exact', head: true })
    .in('video_id', videoIds);

  return count ?? 0;
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
