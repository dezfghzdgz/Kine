// Do 5 lajků upozorňujeme na každý jednotlivý, pak jen na kulaté milníky,
// ať appka nezasypává tvůrce oznámeními u populárních videí.
const MILESTONES = [10, 25, 50, 75, 100];

export function shouldNotifyLikeMilestone(likeCount: number): boolean {
  if (likeCount <= 5) return true;
  if (MILESTONES.includes(likeCount)) return true;
  if (likeCount > 100 && likeCount % 100 === 0) return true;
  return false;
}
