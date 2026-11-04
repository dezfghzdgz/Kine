'use client';

import Link from 'next/link';
import { useLanguage, type DictKey } from '@/lib/i18n';
import UiIcon from './UiIcon';

/** Čtyři důvody, proč tu zůstat - krátce a konkrétně (stejné jako v reklamách). */
const POINTS: DictKey[] = ['guestChipNoAds', 'guestChipRatings', 'guestChipProfile', 'guestChipFreeSpeech'];

/**
 * Uvítání pro nepřihlášené na Domovské - kdo přijde z reklamy, hned vidí, co
 * Kine je a že účet je zdarma. Feed pod ním funguje i bez účtu, takže se dá
 * rovnou koukat. Kdy se ukazuje a kdy ne: lib/homeBanner.ts.
 */
export default function GuestWelcome({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useLanguage();
  return (
    <section className="guest-welcome" aria-labelledby="guest-welcome-title">
      <div className="guest-welcome-glow" aria-hidden="true" />
      <button type="button" className="guest-welcome-close" onClick={onDismiss} aria-label={t('close')} title={t('close')}>
        <UiIcon name="close" size={16} />
      </button>
      <div className="guest-welcome-main">
        <h2 id="guest-welcome-title">{t('guestWelcomeTitle')}</h2>
        <p className="guest-welcome-text">{t('guestWelcomeText')}</p>
        <ul className="guest-welcome-points">
          {POINTS.map((key) => (
            <li key={key}>
              <UiIcon name="check" size={14} />
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
      <div className="guest-welcome-actions">
        <Link href="/signup" className="streams-btn primary">
          {t('guestWelcomeSignup')}
        </Link>
        <Link href="/login" className="streams-btn">
          {t('login')}
        </Link>
      </div>
    </section>
  );
}
