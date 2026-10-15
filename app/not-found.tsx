'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';

/** Neexistující adresa - místo holé stránky Next.js srozumitelná hláška a cesta zpět. */
export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="auth-gate" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>{t('notFoundTitle')}</h1>
      <p>{t('notFoundText')}</p>
      <Link href="/">{t('notFoundHome')}</Link>
    </div>
  );
}
