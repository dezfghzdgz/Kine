'use client';

import { DATE_LOCALES, useLanguage, type DictKey } from '@/lib/i18n';
import { computeBadges, nextBadge, type Badge, type BadgeId, type BadgeStats } from '@/lib/badges';
import UiIcon, { type UiIconName } from './UiIcon';

const ICONS: Record<BadgeId, UiIconName> = {
  early: 'sparkle',
  years: 'timer',
  videos: 'film',
  views: 'eye',
  subscribers: 'users',
  sparks: 'bolt',
  streamer: 'broadcast',
};

/**
 * Odznaky pod jménem kanálu (lib/badges.ts): z každé řady nejvyšší
 * dosažený stupeň, s vysvětlením po najetí myší. Majitel kanálu navíc
 * vidí, který odznak má nejblíž a kolik mu chybí.
 */
export default function ChannelBadges({ stats, own }: { stats: BadgeStats; own: boolean }) {
  const { t, lang } = useLanguage();
  const badges = computeBadges(stats);
  const next = own ? nextBadge(stats) : null;
  if (badges.length === 0 && !next) return null;

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
        return fill('badgeSparks', value);
    }
  };
  const tip = (b: Badge): string => {
    switch (b.id) {
      case 'early':
        return t('badgeEarlyTip');
      case 'streamer':
        return t('badgeStreamerTip');
      case 'years':
        return t('badgeYearsTip');
      case 'videos':
        return fill('badgeVideosTip', b.value);
      case 'views':
        return fill('badgeViewsTip', b.value);
      case 'subscribers':
        return fill('badgeSubscribersTip', b.value);
      case 'sparks':
        return fill('badgeSparksTip', b.value);
    }
  };

  return (
    <div className="channel-badges" aria-label={t('badgesLabel')}>
      {badges.map((b) => (
        <span key={b.id} className={`channel-badge channel-badge-${b.id} level-${Math.min(b.level, 4)}`} title={tip(b)}>
          <UiIcon name={ICONS[b.id]} size={13} />
          {label(b.id, b.value)}
        </span>
      ))}
      {next && (
        <span className="channel-badge-next" title={t('badgeNextTip')}>
          <UiIcon name={ICONS[next.id]} size={13} />
          {t('badgeNext').replace('{badge}', label(next.id, next.target)).replace('{missing}', number(next.missing))}
        </span>
      )}
    </div>
  );
}
