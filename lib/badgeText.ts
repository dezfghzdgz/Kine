import { DATE_LOCALES, type DictKey, type Lang } from './i18n';
import type { Badge, BadgeId } from './badges';
import type { UiIconName } from '@/components/UiIcon';

/**
 * Texty a vzhled odznaků - jedno místo pro kanál, sbírku, oslavné okénko
 * a oznámení (oznámení nese jen "badge:views:1000" a přeloží se až tady,
 * v jazyce, který má divák zrovna zapnutý).
 */

export const BADGE_ICONS: Record<BadgeId, UiIconName> = {
  early: 'sparkle',
  years: 'timer',
  videos: 'film',
  views: 'eye',
  subscribers: 'users',
  sparks: 'bolt',
  streamer: 'broadcast',
  likes: 'thumbUp',
  hit: 'trophy',
  streamHours: 'record',
  posts: 'pencil',
  comments: 'chat',
  collabs: 'link',
};

/**
 * Barva stupně: bronz, stříbro, zlato, platina, diamant, mistr, legenda,
 * mýtus (od diamantu se lesknou, legenda a mýtus mají živý přechod);
 * Průkopník a Streamer mají vlastní.
 */
export function badgeTierClass(b: Pick<Badge, 'id' | 'level'>): string {
  if (b.id === 'early') return 'tier-pioneer';
  if (b.id === 'streamer') return 'tier-live';
  return `tier-${Math.max(0, Math.min(Number.isFinite(b.level) ? b.level : 0, 7))}`;
}

const TIER_NAME_KEYS: DictKey[] = ['badgeTier0', 'badgeTier1', 'badgeTier2', 'badgeTier3', 'badgeTier4', 'badgeTier5', 'badgeTier6', 'badgeTier7'];

/** Název stupně ("Zlato") - pro sbírku. */
export function badgeTierName(level: number, t: (key: DictKey) => string): string {
  return t(TIER_NAME_KEYS[Math.max(0, Math.min(level, TIER_NAME_KEYS.length - 1))]);
}

type T = (key: DictKey) => string;

export function badgeTexts(t: T, lang: Lang) {
  const number = (n: number) => {
    try {
      return new Intl.NumberFormat(DATE_LOCALES[lang]).format(n);
    } catch {
      return String(n);
    }
  };
  const fill = (key: DictKey, n: number) => t(key).replace('{n}', number(n));
  const yearsKey = (n: number): DictKey => {
    let rule: Intl.LDMLPluralRule = 'other';
    try {
      rule = new Intl.PluralRules(DATE_LOCALES[lang]).select(n);
    } catch {
      // obecný tvar
    }
    return rule === 'one' ? 'badgeYearsOne' : rule === 'few' ? 'badgeYearsFew' : 'badgeYearsMany';
  };

  const label = (id: BadgeId, value: number): string => {
    switch (id) {
      case 'early':
        return t('badgeEarly');
      case 'streamer':
        return t('badgeStreamer');
      case 'years':
        return fill(yearsKey(value), value);
      case 'videos':
        return value === 1 ? t('badgeFirstVideo') : fill('badgeVideos', value);
      case 'views':
        return fill('badgeViews', value);
      case 'subscribers':
        return fill('badgeSubscribers', value);
      case 'sparks':
        return value === 1 ? t('badgeFirstSpark') : fill('badgeSparks', value);
      case 'likes':
        return fill('badgeLikes', value);
      case 'hit':
        return fill('badgeHit', value);
      case 'streamHours':
        return fill('badgeStreamHours', value);
      case 'posts':
        return value === 1 ? t('badgeFirstPost') : fill('badgePosts', value);
      case 'comments':
        return fill('badgeComments', value);
      case 'collabs':
        return value === 1 ? t('badgeFirstCollab') : fill('badgeCollabs', value);
    }
  };

  const tip = (id: BadgeId, value: number): string => {
    switch (id) {
      case 'early':
        return t('badgeEarlyTip');
      case 'streamer':
        return t('badgeStreamerTip');
      case 'years':
        return t('badgeYearsTip');
      case 'videos':
        return fill('badgeVideosTip', value);
      case 'views':
        return fill('badgeViewsTip', value);
      case 'subscribers':
        return fill('badgeSubscribersTip', value);
      case 'sparks':
        return fill('badgeSparksTip', value);
      case 'likes':
        return fill('badgeLikesTip', value);
      case 'hit':
        return fill('badgeHitTip', value);
      case 'streamHours':
        return fill('badgeStreamHoursTip', value);
      case 'posts':
        return fill('badgePostsTip', value);
      case 'comments':
        return fill('badgeCommentsTip', value);
      case 'collabs':
        return fill('badgeCollabsTip', value);
    }
  };

  /** Název řady pro sbírku (u zamčené řady bez čísla). */
  const series = (id: BadgeId): string => {
    switch (id) {
      case 'early':
        return t('badgeEarly');
      case 'streamer':
        return t('badgeStreamer');
      case 'years':
        return t('badgeSeriesYears');
      case 'videos':
        return t('badgeSeriesVideos');
      case 'views':
        return t('badgeSeriesViews');
      case 'subscribers':
        return t('badgeSeriesSubscribers');
      case 'sparks':
        return 'Sparks';
      case 'likes':
        return t('badgeSeriesLikes');
      case 'hit':
        return t('badgeSeriesHit');
      case 'streamHours':
        return t('badgeSeriesStreamHours');
      case 'posts':
        return t('badgeSeriesPosts');
      case 'comments':
        return t('badgeSeriesComments');
      case 'collabs':
        return t('badgeSeriesCollabs');
    }
  };

  return { number, label, tip, series };
}

/**
 * Oznámení o odznaku: "badge:views:1000" = nový odznak, "badges:5" = první
 * kontrola (máš 5 odznaků). Jiný text = null (vypíše se tak, jak je).
 */
export function badgeNotificationText(message: string, t: T, lang: Lang): string | null {
  const one = /^badge:([a-zA-Z]+):(\d+)$/.exec(message);
  if (one) {
    const id = one[1] as BadgeId;
    if (!(id in BADGE_ICONS)) return null;
    return t('badgeNotif').replace('{badge}', badgeTexts(t, lang).label(id, Number(one[2])));
  }
  const all = /^badges:(\d+)$/.exec(message);
  if (all) return t('badgesNotifFirst').replace('{n}', all[1]);
  // Víc nových odznaků naráz (třeba po přidání nových řad) - jedno oznámení, ne pět.
  const many = /^badges-new:(\d+)$/.exec(message);
  if (many) return t('badgeNotifMany').replace('{n}', many[1]);
  return null;
}
