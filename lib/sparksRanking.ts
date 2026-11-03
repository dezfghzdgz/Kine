/**
 * Pořadí Sparks (app/sparks/page.tsx a příprava z hlavní stránky -
 * lib/sparksPrefetch.ts).
 *
 * Dřív byly Sparks prostě nejnovější videa - pro každého stejná a ve stejném
 * pořadí, i ta, která divák viděl před chvílí. Teď:
 *  - čerstvé napřed (Sparks stárnou rychleji než dlouhá videa), k tomu
 *    oblíbenost a kvalita,
 *  - zhlédnuté (historie na účtu i v prohlížeči) daleko dozadu, přeskočené
 *    (karta byla na řadě, ale divák hned odjel) o kus níž,
 *  - kousek náhody stálé ~30 minut (lib/seededRandom.ts) - Sparks nezačínají
 *    pořád stejně, ale ani se nepřehází při každém obnovení,
 *  - jeden kanál nezaplní řadu za sebou,
 *  - vlastní a schovaná videa ne, premiéra ani naplánované video taky ne.
 *
 * Čisté funkce bez prohlížeče (tests/feedRanking.test.mjs).
 */

import { isSpark } from './videoBlocks';
import { DAY_MS, diversify, impressionPenalty, releaseTime, watchVerdict, type WatchInfo } from './homeRecommendation';
import { isHiddenBy, isOwnVideo, ownerIdOf, startsLater, type HiddenSets } from './feedFilters';

export type SparkRankContext = {
  viewerId?: string | null;
  hidden?: HiddenSets | null;
  /** Historie na účtu (s rozkoukaností). */
  watched?: Map<string, WatchInfo> | null;
  /** Zhlédnuté v tomhle prohlížeči (aspoň pár vteřin - lib/upNext.ts, rememberSeen). */
  seenLocal?: ReadonlySet<string> | null;
  /** Kolikrát byla karta na řadě bez zhlédnutí (lib/feedImpressions.ts). */
  impressions?: ((videoId: string) => number) | null;
  subscribed?: ReadonlySet<string> | null;
  /** Náhoda 0-1 pro video, stálá ~30 minut. */
  random?: ((videoId: string) => number) | null;
  now?: number;
};

/** Smí Spark do řady? (Konkrétní Spark z odkazu ?start= se pustí i tak.) */
export function sparkEligible(video: any, ctx: SparkRankContext): boolean {
  if (!video?.id || !isSpark(video)) return false;
  if (isOwnVideo(video, ctx.viewerId)) return false;
  if (isHiddenBy(video, ctx.hidden)) return false;
  return !startsLater(video, ctx.now ?? Date.now());
}

export function sparkScore(video: any, ctx: SparkRankContext): number {
  const now = ctx.now ?? Date.now();
  const ageDays = (now - releaseTime(video, now)) / DAY_MS;
  const age = Number.isFinite(ageDays) ? Math.max(0, ageDays) : 30;
  const recency = Math.exp(-age / 4) * 40;
  const popularity = Math.log10(Math.max(0, Number(video.views) || 0) + 1) * 6;
  const engagement = typeof video.engagement === 'number' && Number.isFinite(video.engagement) ? Math.max(0, Math.min(1, video.engagement)) : null;
  const quality = engagement === null ? 0 : Math.round((engagement - 0.5) * 30);

  const verdict = watchVerdict(ctx.watched?.get(video.id), video, now);
  let watched = 0;
  if (verdict.reason === 'watched') watched = -70;
  else if (verdict.reason === 'partial' || verdict.reason === 'resume') watched = -30;
  else if (verdict.reason === 'quick') watched = -12;
  if (watched > -70 && ctx.seenLocal?.has(video.id)) watched = -70;

  const skipped = ctx.impressions ? impressionPenalty(ctx.impressions(video.id)) : 0;
  const owner = ownerIdOf(video);
  const subscribed = owner && ctx.subscribed?.has(owner) ? 12 : 0;
  const unit = ctx.random ? Number(ctx.random(String(video.id))) : Math.random();
  const jitter = (Number.isFinite(unit) ? Math.max(0, Math.min(1, unit)) : 0) * 20;

  return recency + popularity + quality + watched + skipped + subscribed + jitter;
}

/** Seřadí Sparks pro diváka (bez nevhodných, viz sparkEligible). */
export function rankSparks<T>(list: readonly T[], ctx: SparkRankContext): T[] {
  const seen = new Set<string>();
  const eligible = list.filter((v: any) => {
    if (!sparkEligible(v, ctx) || seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  const scores = new Map<string, number>(eligible.map((v: any) => [v.id, sparkScore(v, ctx)]));
  // Kanál bez owner_id ve výběru (jen profil) - rozmanitost pak podle profilu.
  const withOwner = eligible.map((v: any) => ({ v, owner_id: ownerIdOf(v) ?? null, category: null as string | null }));
  return diversify(withOwner, (x) => scores.get((x.v as any).id) ?? 0, { sameOwner: 20, sameCategory: 0 }).map((x) => x.v);
}
