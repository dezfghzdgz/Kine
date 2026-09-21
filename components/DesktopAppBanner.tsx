'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { isInDesktopApp } from '@/lib/desktopRelease';

const DISMISS_KEY = 'kine-desktop-banner-dismissed';

/**
 * Proužek nahoře na hlavní stránce: "Kine do PC - stáhnout". Aby lidi
 * nemuseli vědět, kam přesně jít (odkaz v levém menu úplně dole je
 * snadné přehlédnout). Jen na počítači (CSS třída sidebar-desktop-only),
 * ne v okně appky, a po zavření křížkem si to prohlížeč pamatuje.
 */
export default function DesktopAppBanner() {
  const { t } = useLanguage();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (isInDesktopApp() || localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // bez localStorage se proužek prostě ukáže
    }
    setShow(true);
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
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
