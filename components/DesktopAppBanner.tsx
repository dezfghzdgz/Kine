'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { desktopBannerDismissed, isInDesktopApp } from '@/lib/desktopRelease';

const DISMISS_KEY = 'kine-desktop-banner-dismissed';

/**
 * Proužek nahoře na hlavní stránce: "Kine do PC - stáhnout". Aby lidi
 * nemuseli vědět, kam přesně jít (odkaz v levém menu úplně dole je
 * snadné přehlédnout). Jen na počítači (CSS třída sidebar-desktop-only),
 * ne v okně appky. Po zavření křížkem si prohlížeč pamatuje čas zavření
 * a proužek se vrátí až po týdnu (kdo appku mezitím stáhl, ho v jejím
 * okně nevidí vůbec).
 */
export default function DesktopAppBanner() {
  const { t } = useLanguage();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (isInDesktopApp()) return;
      const stored = localStorage.getItem(DISMISS_KEY);
      // Starší verze ukládala jen "1" (navždy): brát jako zavřené dnes, ať se proužek vrátí za týden.
      if (stored === '1') {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        return;
      }
      if (desktopBannerDismissed(stored)) return;
    } catch {
      // bez localStorage se proužek prostě ukáže
    }
    setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // nevadí
    }
  }

  return (
    <div className="panel sidebar-desktop-only desktop-banner" role="note">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
      <div className="desktop-banner-text">
        <strong>{t('desktopBannerTitle')}</strong>
        <span>{t('desktopBannerText')}</span>
      </div>
      <Link href="/download" className="reaction-btn active" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
        {t('desktopBannerButton')}
      </Link>
      <button type="button" className="desktop-banner-close" onClick={dismiss} aria-label={t('close')} title={t('close')}>
        ✕
      </button>
    </div>
  );
}
