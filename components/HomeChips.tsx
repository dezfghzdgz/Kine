'use client';

import Link from 'next/link';
import { useLanguage, type DictKey } from '@/lib/i18n';

/**
 * Řada kategorií nad feedem na Domovské (jako na YouTube): Vše · Hry · Sparks ·
 * Živě · Hudba… Jedním klepnutím na výběr podle tématu - kategorie vedou na
 * Prozkoumat, kde už filtr je (hry mají navíc řadu her). Na telefonu se řada
 * posouvá do strany.
 */
const CHIPS: { key: DictKey; href: string }[] = [
  { key: 'contentTypeAll', href: '/' },
  { key: 'catGaming', href: '/explore?category=catGaming' },
  { key: 'sparksOption', href: '/sparks' },
  { key: 'navLive', href: '/streams' },
  { key: 'trending', href: '/explore?tab=trending' },
  { key: 'newest', href: '/explore?tab=newest' },
  { key: 'catMusic', href: '/explore?category=catMusic' },
  { key: 'catEntertainment', href: '/explore?category=catEntertainment' },
  { key: 'catScience', href: '/explore?category=catScience' },
  { key: 'catEducation', href: '/explore?category=catEducation' },
  { key: 'catSports', href: '/explore?category=catSports' },
  { key: 'catComedy', href: '/explore?category=catComedy' },
];

export default function HomeChips() {
  const { t } = useLanguage();
  return (
    <nav className="home-chips" aria-label={t('homeChipsLabel')}>
      {CHIPS.map((chip, i) => (
        <Link key={chip.key} href={chip.href} className={`home-chip${i === 0 ? ' active' : ''}`} aria-current={i === 0 ? 'page' : undefined}>
          {t(chip.key)}
        </Link>
      ))}
    </nav>
  );
}
