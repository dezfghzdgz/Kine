'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { countLabel } from '@/lib/plural';
import { groupByDay, type FanEntry } from '@/lib/fans';
import UiIcon from './UiIcon';

/**
 * Zeď fanoušků (playkine.com/fans): přezdívky lidí, kteří Kine sledují od
 * prvních dní (kampaň na Instagramu "Den 1…"). Nahoře počet, pod tím dny
 * kampaně od nejnovějšího - nové jméno je hned vidět, když se natáčí.
 * Kdo má i účet na Kine, má u jména odkaz na svůj kanál.
 * Data načte server (app/fans/page.tsx, lib/fansServer.ts).
 */
export default function FansWall({
  available,
  entries,
  total,
  instagramUrl,
}: {
  available: boolean;
  entries: FanEntry[];
  total: number;
  instagramUrl: string | null;
}) {
  const { t, lang } = useLanguage();
  const days = groupByDay(entries);
  const newest = days[0]?.day ?? null;

  return (
    <div className="fans-page">
      <section className="fans-hero">
        <div className="fans-hero-glow" aria-hidden="true" />
        <p className="fans-kicker">{t('fansKicker')}</p>
        <p className="fans-count" aria-live="polite">
          {new Intl.NumberFormat(lang).format(total)}
        </p>
        <h1>{t('fansTitle')}</h1>
        <p className="fans-tagline">{t('fansSubtitle')}</p>
        {instagramUrl && (
          <div className="fans-cta">
            <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="streams-btn primary">
              <UiIcon name="heart" size={16} />
              {t('fansFollowButton')}
            </a>
          </div>
        )}
      </section>

      {!available || entries.length === 0 ? (
        <p className="fans-empty">{t('fansEmpty')}</p>
      ) : (
        days.map((d) => (
          <section key={d.day} className={`fans-day${d.day === newest ? ' newest' : ''}`} aria-label={t('fansDay').replace('{n}', String(d.day))}>
            <h2 className="fans-day-head">
              <span>{t('fansDay').replace('{n}', String(d.day))}</span>
              <span className="fans-day-count">{countLabel(d.entries.length, lang, t, 'fansPeople')}</span>
            </h2>
            <ul className="fans-grid">
              {d.entries.map((e) => (
                <li key={e.id}>
                  {e.kine ? (
                    <Link href={`/channel/${e.kine.id}`} className="fans-chip linked" title={t('fansKineChannel').replace('{name}', e.kine.username)}>
                      @{e.handle}
                      <UiIcon name="play" size={12} />
                    </Link>
                  ) : (
                    <span className="fans-chip">@{e.handle}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
