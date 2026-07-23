import { supabaseServer } from './supabaseServer';

// Jednoduchý výpočet "důvěryhodnosti" tvůrce, dokud nemáme nahlašování obsahu.
// Skládá se ze dvou věcí:
// 1. Jak dlouho tvůrce používá platformu (starší účet = trochu vyšší základ)
// 2. Poměr lajk/dislike na jeho videích (pokud nějaké má)
// V budoucnu se dá rozšířit o nahlášení obsahu, ověření emailu apod.
export async function computeTrustRating(profileId: string, profileCreatedAt: string): Promise<number> {
  const ageDays = (Date.now() - new Date(profileCreatedAt).getTime()) / (1000 * 60 * 60 * 24);
  const ageScore = Math.min(ageDays / 180, 1); // max bonus po půl roce

  const { data: videos } = await supabaseServer
    .from('videos')
    .select('id')
    .eq('owner_id', profileId);

  const videoIds = (videos ?? []).map((v) => v.id);

  let likeRatio = 0.9; // neutrální výchozí hodnota, dokud nemá žádné reakce
  if (videoIds.length > 0) {
    const { data: reactions } = await supabaseServer
      .from('video_reactions')
      .select('score')
      .in('video_id', videoIds);

    if (reactions && reactions.length > 0) {
      const avgScore = reactions.reduce((sum, r) => sum + (r.score ?? 3), 0) / reactions.length;
      likeRatio = (avgScore - 1) / 4; // převod škály 1-5 na poměr 0-1
    }
  }

  const score = 60 + ageScore * 20 + likeRatio * 20;
  return Math.round(Math.min(Math.max(score, 50), 99));
}
