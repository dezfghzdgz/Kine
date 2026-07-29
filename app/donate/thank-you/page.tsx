'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';

export default function DonateThankYouPage() {
  const { t } = useLanguage();

  return (
    <div style={{ maxWidth: 480, textAlign: 'center', padding: '60px 0' }}>
      <p style={{ fontSize: 40, marginBottom: 10 }}>💛</p>
      <p className="section-title">{t('donateThankYouTitle')}</p>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 24 }}>{t('donateThankYouNote')}</p>
      <Link href="/">
        <button type="button">{t('donateBackToHomeButton')}</button>
      </Link>
    </div>
  );
}
