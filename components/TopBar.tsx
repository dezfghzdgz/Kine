'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useMobileNav } from '@/lib/mobileNavContext';
import { useLanguage } from '@/lib/i18n';
import { OPEN_SEARCH_EVENT } from './KeyboardShortcuts';
import { CATEGORY_KEYS } from '@/lib/categories';
import { DEFAULT_FILTERS, parseSearchFilters, searchHref, type SearchFilters } from '@/lib/searchFilters';

const SCOPED_PATHS = ['/activity', '/downloaded', '/your-videos', '/playlists', '/subscriptions', '/watch-later'];

/**
 * Co už platí v adrese (/search?q=...&type=...&minRating=80): pole i panel
 * filtrů se otevřou s tím, co divák právě vidí, ne prázdné. Čte se přímo
 * z window.location - useSearchParams by v horní liště (je v každé stránce)
 * chtěl obalit celou stránku do Suspense.
 */
function readSearchUrl(): { query: string; filters: SearchFilters; highRating: boolean } {
  if (typeof window === 'undefined') return { query: '', filters: DEFAULT_FILTERS, highRating: false };
  const params = new URLSearchParams(window.location.search);
  const record: Record<string, string> = {};
  params.forEach((value, key) => {
    if (!(key in record)) record[key] = value;
  });
  return { query: params.get('q') ?? '', filters: parseSearchFilters(record), highRating: !!params.get('minRating') };
}

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
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scoped = SCOPED_PATHS.includes(pathname);
  const activeCount =
    (highRatingOnly ? 1 : 0) +
    (filters.type !== 'all' ? 1 : 0) +
    (filters.date !== 'any' ? 1 : 0) +
    (filters.duration !== 'any' ? 1 : 0) +
    (filters.sort !== 'relevance' ? 1 : 0) +
    (filters.category !== 'any' ? 1 : 0);
  const setFilter = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  /** Na stránce výsledků (nebo v hledání v sekci) vezme hledaný text a filtry z adresy. */
  function syncFromUrl(withQuery: boolean) {
    if (pathname !== '/search' && !scoped) return;
    const fromUrl = readSearchUrl();
    if (withQuery && fromUrl.query) setQuery((q) => q || fromUrl.query);
    if (pathname === '/search') {
      setFilters(fromUrl.filters);
      setHighRatingOnly(fromUrl.highRating);
    }
  }

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
    syncFromUrl(true);
    setActive(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function toggleAdvanced() {
    if (!advancedOpen) syncFromUrl(false);
    setAdvancedOpen((v) => !v);
  }

  // Klávesa "/" kdekoliv v appce otevře tohle pole a rovnou do něj skočí.
  useEffect(() => {
    function handleOpenRequest() {
      openSearch();
    }
    window.addEventListener(OPEN_SEARCH_EVENT, handleOpenRequest);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, handleOpenRequest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      inputRef.current?.focus();
      return;
    }

    // Hledání v sekci (Historie, Tvoje videa...) umí jen text. S filtry se
    // hledá na celém Kine - jinak by je hledání v sekci potichu zahodilo.
    if (scoped && activeCount === 0) {
      router.push(`${pathname}?${new URLSearchParams({ q }).toString()}`);
    } else {
      router.push(searchHref(q, filters, {}, highRatingOnly ? '80' : null));
    }
    setAdvancedOpen(false);
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setHighRatingOnly(false);
  }

  const chip = (selected: boolean, label: string, onClick: () => void, title?: string) => (
    <button key={label} type="button" className={`search-chip ${selected ? 'active' : ''}`} aria-pressed={selected} onClick={onClick} title={title}>
      {label}
    </button>
  );
  const categories = [...CATEGORY_KEYS].sort((a, b) => t(a).localeCompare(t(b)));

  return (
    <div className="top-bar">
      <div ref={wrapRef} className="top-bar-slot" style={{ position: 'relative', display: 'flex' }}>
        {active ? (
          <div className="top-bar-search-wrap">
            <form onSubmit={handleSubmit} className="top-bar-search-form" role="search">
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                placeholder={scoped ? t('searchThisSection') : t('search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                enterKeyHint="search"
              />
              <button
                type="button"
                className={`icon-btn top-bar-filter-btn ${advancedOpen ? 'open' : ''}`}
                onClick={toggleAdvanced}
                aria-label={t('advancedSearch')}
                aria-expanded={advancedOpen}
                title={t('advancedSearch')}
              >
                <FilterIcon />
                {activeCount > 0 && <span className="top-bar-filter-count">{activeCount}</span>}
              </button>
            </form>

            {/* Panel visí přímo pod polem hledání (dřív byl u pravého kraje
                celé lišty, daleko od pole). Filtry jsou stejné jako na
                stránce výsledků - tady se dají nastavit předem. */}
            {advancedOpen && (
              <div className="profile-dropdown search-panel" role="group" aria-label={t('advancedSearch')}>
                <p className="search-panel-title">{t('advancedSearch')}</p>

                <div className="search-panel-row">
                  <span className="search-filter-label">{t('searchFilterCreators')}</span>
                  <div className="search-panel-chips">
                    {chip(!highRatingOnly, t('searchRatingAny'), () => setHighRatingOnly(false))}
                    {chip(highRatingOnly, t('searchRating80'), () => setHighRatingOnly(true), t('highRatingOnly'))}
                  </div>
                </div>

                <div className="search-panel-row">
                  <span className="search-filter-label">{t('searchFilterType')}</span>
                  <div className="search-panel-chips">
                    {chip(filters.type === 'all', t('contentTypeAll'), () => setFilter('type', 'all'))}
                    {chip(filters.type === 'long', t('contentTypeVideos'), () => setFilter('type', 'long'))}
                    {chip(filters.type === 'sparks', t('contentTypeSparks'), () => setFilter('type', 'sparks'))}
                  </div>
                </div>

                <div className="search-panel-grid">
                  <label className="search-panel-field">
                    <span>{t('searchFilterDate')}</span>
                    <select value={filters.date} onChange={(e) => setFilter('date', e.target.value as SearchFilters['date'])}>
                      <option value="any">{t('searchFilterAny')}</option>
                      <option value="hour">{t('searchDateHour')}</option>
                      <option value="today">{t('searchDateToday')}</option>
                      <option value="week">{t('searchDateWeek')}</option>
                      <option value="month">{t('searchDateMonth')}</option>
                      <option value="year">{t('searchDateYear')}</option>
                    </select>
                  </label>
                  <label className="search-panel-field">
                    <span>{t('searchFilterDuration')}</span>
                    <select value={filters.duration} onChange={(e) => setFilter('duration', e.target.value as SearchFilters['duration'])}>
                      <option value="any">{t('searchDurationAny')}</option>
                      <option value="short">{t('searchDurationShort')}</option>
                      <option value="medium">{t('searchDurationMedium')}</option>
                      <option value="long">{t('searchDurationLong')}</option>
                    </select>
                  </label>
                  <label className="search-panel-field">
                    <span>{t('searchFilterSort')}</span>
                    <select value={filters.sort} onChange={(e) => setFilter('sort', e.target.value as SearchFilters['sort'])}>
                      <option value="relevance">{t('searchSortRelevance')}</option>
                      <option value="date">{t('searchSortDate')}</option>
                      <option value="views">{t('searchSortViews')}</option>
                    </select>
                  </label>
                  <label className="search-panel-field">
                    <span>{t('searchFilterCategory')}</span>
                    <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
                      <option value="any">{t('searchCategoryAny')}</option>
                      {categories.map((key) => (
                        <option key={key} value={key}>
                          {t(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="search-panel-actions">
                  <button type="button" className="search-panel-reset" onClick={resetFilters} disabled={activeCount === 0}>
                    {t('searchResetFilters')}
                  </button>
                  <button type="button" className="search-panel-apply" onClick={() => handleSubmit()}>
                    {scoped && activeCount > 0 ? t('searchAllKine') : t('searchApply')}
                  </button>
                </div>
                {!query.trim() && <p className="search-panel-hint">{t('searchEmptyPrompt')}</p>}
              </div>
            )}
          </div>
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
