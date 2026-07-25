'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useMobileNav } from '@/lib/mobileNavContext';

const SCOPED_PATHS = ['/activity', '/downloaded', '/your-videos', '/playlists', '/subscriptions', '/watch-later'];

export default function TopBar() {
  const { open: mobileNavOpen, toggle: toggleMobileNav } = useMobileNav();
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
              placeholder={SCOPED_PATHS.includes(pathname) ? 'Search this section…' : 'Search…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-label="Advanced search"
            >
              ⋮
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={toggleMobileNav}
              className="top-bar-search-icon-btn mobile-menu-toggle-btn"
              aria-label="Menu"
            >
              ⋮
            </button>
            <button onClick={openSearch} className="top-bar-search-icon-btn" aria-label="Search">
              <SearchIcon />
            </button>
            <div className="top-bar-ad">Ad space</div>
          </>
        )}

        {advancedOpen && (
          <div className="profile-dropdown" style={{ top: 'calc(100% + 8px)', bottom: 'auto', left: 'auto', right: 0, width: 260 }}>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 8px 8px' }}>Advanced search</p>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={highRatingOnly}
                onChange={(e) => setHighRatingOnly(e.target.checked)}
              />
              Only creators with a high rating (80%+)
            </label>

            <div style={{ padding: '6px 8px' }}>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 4px' }}>Content type</p>
              <select value={contentType} onChange={(e) => setContentType(e.target.value as 'all' | 'long' | 'sparks')} style={{ width: '100%' }}>
                <option value="all">All</option>
                <option value="long">Videos only</option>
                <option value="sparks">Sparks only</option>
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
