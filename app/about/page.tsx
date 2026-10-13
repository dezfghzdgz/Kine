'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { DESKTOP_APP_NAMES } from '@/lib/desktopRelease';
import { PAYMENTS_ENABLED } from '@/lib/payments';

/**
 * O Kine - veřejná stránka pro kohokoli (i bez přihlášení): co Kine je,
 * co děláme a naše appky - Kine na webu, Kine do PC a Kine Clipper.
 * Odkaz je v menu (O Kine), v nabídce profilu a na stránce Stáhnout.
 */

function Icon({ name }: { name: 'video' | 'live' | 'fair' | 'earn' | 'safe' | 'look' }) {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'video':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'live':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="2" />
          <path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.5 9.5 0 0 1 0-13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4" />
        </svg>
      );
    case 'fair':
      return (
        <svg {...common}>
          <path d="M12 4v16M5 8h14M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z" />
        </svg>
      );
    case 'earn':
      return (
        <svg {...common}>
          <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z" />
        </svg>
      );
    case 'safe':
      return (
        <svg {...common}>
          <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />
          <path d="M8.5 12l2.5 2.5 4.5-5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 3.5v17M3.5 12h17" opacity="0.5" />
          <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" opacity="0.5" />
        </svg>
      );
  }
}

function AppMark({ kind }: { kind: 'web' | 'full' | 'clipper' }) {
  return (
    <svg className="about-app-mark" width="52" height="52" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0a0a0b" />
      <rect width="64" height="64" rx="14" fill="var(--brand)" fillOpacity="0.16" />
      {kind === 'clipper' ? (
        <>
          <path d="M19.5 17 H13 V47 H19.5" fill="none" stroke="var(--brand)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M44.5 17 H51 V47 H44.5" fill="none" stroke="var(--brand)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M26.5 23 L42.5 32 L26.5 41 Z" fill="var(--brand)" />
        </>
      ) : kind === 'full' ? (
        <>
          <rect x="12" y="15" width="40" height="27" rx="4" fill="none" stroke="var(--brand)" strokeWidth="3" />
          <path d="M26 21.5 L38 28.5 L26 35.5 Z" fill="var(--brand)" />
          <path d="M24 49h16M32 42v7" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <path d="M24 18 L46 32 L24 46 Z" fill="var(--brand)" />
      )}
    </svg>
  );
}

export default function AboutPage() {
  const { t } = useLanguage();
  const features: { icon: Parameters<typeof Icon>[0]['name']; title: string; text: string }[] = [
    { icon: 'video', title: t('aboutFeatVideoTitle'), text: t('aboutFeatVideoText') },
    { icon: 'live', title: t('aboutFeatLiveTitle'), text: t('aboutFeatLiveText') },
    { icon: 'fair', title: t('aboutFeatFairTitle'), text: t('aboutFeatFairText') },
    { icon: 'earn', title: t('aboutFeatEarnTitle'), text: t('aboutFeatEarnText') },
    { icon: 'safe', title: t('aboutFeatSafeTitle'), text: t('aboutFeatSafeText') },
    { icon: 'look', title: t('aboutFeatLookTitle'), text: t('aboutFeatLookText') },
  ];

  return (
    <div className="about-page">
      <section className="about-hero">
        <span className="about-hero-glow" aria-hidden="true" />
        <p className="about-kicker">{t('aboutKicker')}</p>
        <h1>{t('aboutTitle')}</h1>
        <p className="about-tagline">{t('aboutTagline')}</p>
        <div className="about-cta">
          <Link href="/" className="streams-btn primary about-cta-main">
            {t('aboutStartWatching')}
          </Link>
          <Link href="/download" className="streams-btn">
            {t('aboutGetApps')}
          </Link>
        </div>
      </section>

      <section className="about-section">
        <h2>{t('aboutWhatTitle')}</h2>
        <p className="about-lead">{t('aboutWhatText')}</p>
      </section>

      <section className="about-section">
        <h2>{t('aboutDoTitle')}</h2>
        <div className="about-features">
          {features.map((f) => (
            <div key={f.title} className="about-feature panel">
              <span className="about-feature-icon">
                <Icon name={f.icon} />
              </span>
              <p className="about-feature-title">{f.title}</p>
              <p className="about-feature-text">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section">
        <h2>{t('aboutAppsTitle')}</h2>
        <div className="about-apps">
          <div className="about-app panel">
            <AppMark kind="web" />
            <p className="about-app-name">Kine</p>
            <p className="about-app-kind">{t('aboutWebKind')}</p>
            <p className="about-app-text">{t('aboutWebText')}</p>
            <Link href="/" className="streams-btn">
              {t('aboutWebButton')}
            </Link>
          </div>
          <div className="about-app panel primary">
            <AppMark kind="full" />
            <p className="about-app-name">{t('downloadFullTitle')}</p>
            <p className="about-app-kind">{t('aboutPcKind')}</p>
            <p className="about-app-text">{t('aboutFullText')}</p>
            <a href="/download/windows" className="streams-btn primary">
              {t('downloadFullButton')}
            </a>
          </div>
          <div className="about-app panel">
            <AppMark kind="clipper" />
            <p className="about-app-name">{DESKTOP_APP_NAMES.clipper}</p>
            <p className="about-app-kind">{t('aboutPcKind')}</p>
            <p className="about-app-text">{t('aboutClipperText')}</p>
            <a href="/download/windows?variant=clipper" className="streams-btn">
              {t('aboutClipperButton')}
            </a>
          </div>
        </div>
        <p className="about-note">
          {t('aboutAppsNote')} <Link href="/download">{t('aboutAppsMore')} →</Link>
        </p>
      </section>

      <section className="about-section about-beta panel">
        <h2>{t('aboutBetaTitle')}</h2>
        <p>{t('aboutBetaText')}</p>
        <div className="about-links">
          <a href="mailto:kinesupport@gmail.com" className="streams-btn">
            ✉ {t('aboutContact')}
          </a>
          {PAYMENTS_ENABLED && (
            <Link href="/donate" className="streams-btn">
              💛 {t('aboutSupportKine')}
            </Link>
          )}
          <Link href="/plus" className="streams-btn">
            ✦ Kine Plus
          </Link>
        </div>
        <p className="about-legal">
          <Link href="/rules">{t('rulesLink')}</Link> · <Link href="/terms">{t('termsLink')}</Link> · <Link href="/privacy">{t('privacyLink')}</Link> ·{' '}
          <Link href="/copyright">{t('copyrightLink')}</Link>
        </p>
      </section>
    </div>
  );
}
