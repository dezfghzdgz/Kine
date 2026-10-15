'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';

/**
 * Chyba při vykreslení stránky: místo "Application error" od Next.js hláška
 * s tlačítkem Zkusit znovu. Chybu předá hlídači chyb (lib/errorReporter.ts -
 * poslouchá události "error" na window), ať se objeví v přehledu chyb pro správce.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    console.error('Kine: chyba stránky', error?.message ?? error, error?.digest ?? '');
    try {
      window.dispatchEvent(new ErrorEvent('error', { error, message: error?.message ?? 'Chyba stránky' }));
    } catch {
      // starý prohlížeč bez ErrorEvent - jen konzole
    }
  }, [error]);
  return (
    <div className="auth-gate" style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>{t('errorPageTitle')}</h1>
      <p>{t('errorPageText')}</p>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => reset()}>
          {t('errorPageRetry')}
        </button>
        <Link href="/">{t('notFoundHome')}</Link>
      </div>
    </div>
  );
}
