/**
 * Co do doporučení nepatří - jedno místo pro všechny seznamy (hlavní
 * stránka, Explore, Sparks, hledání, další video po konci).
 *
 * Dřív si to každá stránka hlídala po svém a vždycky na něco zapomněla:
 * "Nezajímá mě" platilo jen na hlavní stránce, vlastní videa se tvůrci
 * doporučovala jemu samému a naplánované video prosáklo do odběrů.
 *
 * Čisté funkce bez databáze (tests/feedFilters.test.mjs). Databáze (RLS)
 * hlídá to samé taky - tohle je druhá pojistka v prohlížeči.
 */

import { isHiddenScheduled, isUpcoming } from './scheduling';
import { SPARK_MAX_SECONDS } from './videoBlocks';

/** Schovaná videa a kanály ("Nezajímá mě", "Nedoporučovat kanál"). */
export type HiddenSets = {
  videoIds: ReadonlySet<string>;
  channelIds: ReadonlySet<string>;
};

/**
 * Kdo video nahrál. Supabase vrací navázaný profil jednou jako objekt
 * a jindy jako pole - bereme obojí.
 */
export function ownerIdOf(video: any): string | undefined {
  if (video?.owner_id) return video.owner_id;
  const profiles = video?.profiles;
  if (Array.isArray(profiles)) return profiles[0]?.id;
  return profiles?.id;
}

/** Schoval si ho divák (video samotné, nebo celý kanál)? */
export function isHiddenBy(video: any, hidden: HiddenSets | null | undefined): boolean {
  if (!hidden || (hidden.videoIds.size === 0 && hidden.channelIds.size === 0)) return false;
  const id = video?.id;
  if (id && hidden.videoIds.has(id)) return true;
  const owner = ownerIdOf(video);
  return !!owner && hidden.channelIds.has(owner);
}

/** Vlastní video diváka (doporučovat ho jemu samému nedává smysl). */
export function isOwnVideo(video: any, viewerId: string | null | undefined): boolean {
  if (!viewerId) return false;
  return ownerIdOf(video) === viewerId;
}

/** Ještě nevyšlo: naplánované video (ne premiéra) před časem zveřejnění. */
export function isUnreleased(video: any, now: number = Date.now()): boolean {
  return isHiddenScheduled(video, now);
}

/** Čas zveřejnění v budoucnu - naplánované video i premiéra, která ještě nezačala (pustit nejde). */
export function startsLater(video: any, now: number = Date.now()): boolean {
  return isUpcoming(video, now);
}

export type FeedFilterOptions = {
  viewerId?: string | null;
  hidden?: HiddenSets | null;
  now?: number;
  /** Vlastní videa nechat (hledání, kanál). Výchozí: pryč. */
  allowOwn?: boolean;
  /** Premiéru s odpočtem nechat (hlavní stránka ji ukazuje dopředu). Výchozí: ano. */
  allowUpcomingPremiere?: boolean;
};

/** Smí video do doporučení? */
export function feedEligible(video: any, opts: FeedFilterOptions = {}): boolean {
  if (!video?.id) return false;
  const now = opts.now ?? Date.now();
  if (!opts.allowOwn && isOwnVideo(video, opts.viewerId)) return false;
  if (isHiddenBy(video, opts.hidden)) return false;
  if (isUnreleased(video, now)) return false;
  if (opts.allowUpcomingPremiere === false && startsLater(video, now)) return false;
  return true;
}

/** Seznam jen s tím, co do doporučení smí (pořadí beze změny). */
export function filterFeed<T>(videos: readonly T[], opts: FeedFilterOptions = {}): T[] {
  return videos.filter((v) => feedEligible(v, opts));
}

/**
 * Filtr pro .or() (jeden dotaz): video už vyšlo (premiéra se ve Sparks objeví,
 * až začne) a je krátké - do dvou minut; délka chybí u starších nahrávek
 * a bere se jako krátké (stejně jako lib/videoBlocks.ts - isSpark). Na výšku
 * se dofiltruje v prohlížeči - dva sloupce mezi sebou databáze přes API
 * porovnat neumí.
 */
export function sparkCandidateFilter(nowIso: string): string {
  return `and(or(scheduled_at.is.null,scheduled_at.lte.${nowIso}),or(duration_seconds.is.null,duration_seconds.lte.${SPARK_MAX_SECONDS}))`;
}
