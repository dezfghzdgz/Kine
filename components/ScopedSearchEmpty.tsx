'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';

/**
 * Hledání v knihovně (playlist, lajkovaná, historie...) nic nenašlo:
 * krátce to říct a nabídnout hledání na celém Kine (lib/searchScope.ts).
 */
export default function ScopedSearchEmpty({ query }: { query: string }) {
  const { t } = useLanguage();
  const q = query.trim();
  return (
    <div className="scoped-search-empty" role="status">
      <p>{t('scopedSearchEmpty').replace('{query}', q)}</p>
      <Link href={`/search?${new URLSearchParams({ q }).toString()}`} className="scoped-search-everywhere">
        {t('searchAllKine')}
      </Link>
    </div>
  );
}
