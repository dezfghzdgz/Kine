'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useMobileNav } from '@/lib/mobileNavContext';
import { useLanguage } from '@/lib/i18n';
import { OPEN_SEARCH_EVENT } from './KeyboardShortcuts';

const SCOPED_PATHS = ['/activity', '/downloaded', '/your-videos', '/playlists', '/subscriptions', '/watch-later'];

export default function TopBar() {
  const { open: mobileNavOpen, toggle: toggleMobileNav } = useMobileNav();
  // Horní lišta byla jako jediná komponenta celá anglicky - i pro toho,
  // kdo si appku přepnul do češtiny.
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [highRatingOnly, setHighRatingOnly] = useState(false);
  const [contentType, setContentType] = useState<'all' | 'long' | 'sparks'>('all');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kliknutí kamkoliv mimo celý vyhledávací blok ho zavře - jak
  // rozšířený panel s filtry, tak samotné pole (pokud je prázdné)
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setAdvancedOpen(false);
        if (!query.trim()) setActive(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [query]);

  function openSearch() {
    setActive(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  // Klávesa "/" kdekoliv v appce otevře tohle pole a rovnou do něj skočí.
  useEffect(() => {
    function handleOpenRequest() {
      openSearch();
    }
    window.addEventListener(OPEN_SEARCH_EVENT, handleOpenRequest);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, handleOpenRequest);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    const params = new URLSearchParams();
    params.set('q', query.trim());
    if (highRatingOnly) params.set('minRating', '80');
    if (contentType !== 'all') params.set('type', contentType);

    if (SCOPED_PATHS.includes(pathname)) {
      router.push(`${pathname}?${params.toString()}`);
    } else {
      router.push(`/search?${params.toString()}`);
    }
    setAdvancedOpen(false);
  }

  return (
    <div className="top-bar">
      <div ref={wrapRef} className="top-bar-slot" style={{ position: 'relative', display: 'flex' }}>
        {active ? (
          <form onSubmit={handleSubmit} className="top-bar-search-form" style={{ flex: 1 }}>
            <SearchIcon />
            <input
              ref={inputRef}
              type="text"
              placeholder={SCOPED_PATHS.includes(pathname) ? t('searchThisSection') : t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-label={t('advancedSearch')}
              title={t('advancedSearch')}
            >
              <FilterIcon />
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={toggleMobileNav}
              className="top-bar-search-icon-btn mobile-menu-toggle-btn"
              aria-label={t('menuLabel')}
            >
              <MenuIcon />
            </button>
            {/* Dřív tu byla jen lupa a vedle ní rámeček s nápisem
                "Ad space". Zabíralo to vršek každé stránky a nedělalo
                nic. Teď je tu jedno pole, které vypadá jako hledání a
                po kliknutí se jím opravdu stane. */}
            <button
              type="button"
              onClick={openSearch}
              className="top-bar-search-trigger"
              aria-label={t('search')}
            >
              <SearchIcon />
              <span className="top-bar-search-trigger-text">
                {SCOPED_PATHS.includes(pathname) ? t('searchThisSection') : t('search')}
              </span>
              <kbd className="top-bar-search-hint">/</kbd>
            </button>
          </>
        )}

        {advancedOpen && (
          <div className="profile-dropdown" style={{ top: 'calc(100% + 8px)', bottom: 'auto', left: 'auto', right: 0, width: 260 }}>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 8px 8px' }}>{t('advancedSearch')}</p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={highRatingOnly}
                onChange={(e) => setHighRatingOnly(e.target.checked)}
              />
              {t('highRatingOnly')}
            </label>

            <div style={{ padding: '6px 8px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 4px' }}>{t('contentTypeLabel')}</p>
              <select value={contentType} onChange={(e) => setContentType(e.target.value as 'all' | 'long' | 'sparks')} style={{ width: '100%' }}>
                <option value="all">{t('contentTypeAll')}</option>
                <option value="long">{t('contentTypeVideos')}</option>
                <option value="sparks">{t('contentTypeSparks')}</option>
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: 'var(--text-faint)' }}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" strokeLinecap="round" />
    </svg>
  );
}

// Tři tečky znamenají "další možnosti" a byly tu na dvou tlačítkách,
// která dělají něco úplně jiného. Nabídka má vlastní ikonu, filtry taky.
function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  );
}
