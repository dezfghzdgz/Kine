'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';
import { categoryLabel, isCategoryKey } from '@/lib/categories';
import { LiveCard, type LiveItem } from '@/components/LiveNowRow';

type Sort = 'foryou' | 'viewers' | 'newest';
const SORTS: Sort[] = ['foryou', 'viewers', 'newest'];

/** Stránka Živě: všechny přenosy, které teď běží - kategorie, řazení, diváci. */
export default function StreamsPage() {
  return (
    <Suspense fallback={null}>
      <StreamsInner />
    </Suspense>
  );
}

function StreamsInner() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const router = useRouter();
  const [streams, setStreams] = useState<LiveItem[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState<Sort>(() => {
    const s = params.get('sort');
    return s === 'viewers' || s === 'newest' ? s : 'foryou';
  });
  const [category, setCategory] = useState<string | null>(() => {
    const c = params.get('category');
    return isCategoryKey(c) ? c : null;
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.hidden) return;
      try {
        // S přihlášením jde tvůj přenos a odebírané kanály dopředu (lib/liveNow.ts).
        const res = await fetch('/api/live/now?limit=60&viewers=1', { cache: 'no-store', headers: await authHeaders() });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (body && Array.isArray(body.streams)) {
          setStreams(body.streams);
          setEnabled(body.enabled !== false);
          setFailed(false);
        } else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    const refresh = setInterval(load, 20 * 1000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Volby v adrese - odkaz jde poslat ("koukni, kdo hraje hry").
  function choose(next: { sort?: Sort; category?: string | null }) {
    const s = next.sort ?? sort;
    const c = next.category === undefined ? category : next.category;
    setSort(s);
    setCategory(c);
    const q = new URLSearchParams();
    if (c) q.set('category', c);
    if (s !== 'foryou') q.set('sort', s);
    router.replace(q.toString() ? `/streams?${q}` : '/streams', { scroll: false });
  }

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of streams ?? []) if (s.category) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [streams]);

  const shown = useMemo(() => {
    const list = (streams ?? []).filter((s) => !category || s.category === category);
    if (sort === 'viewers') {
      return list
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (b.s.viewers ?? -1) - (a.s.viewers ?? -1) || a.i - b.i)
        .map(({ s }) => s);
    }
    if (sort === 'newest') {
      const at = (s: LiveItem) => (s.startedAt ? new Date(s.startedAt).getTime() || 0 : 0);
      return [...list].sort((a, b) => at(b) - at(a));
    }
    return list;
  }, [streams, category, sort]);

  const sortLabel: Record<Sort, string> = {
    foryou: t('streamsSortForYou'),
    viewers: t('streamsSortViewers'),
    newest: t('streamsSortNewest'),
  };
  const total = streams?.length ?? 0;

  return (
    <div className="streams-page">
      <div className="streams-head">
        <div>
          <h1 className="streams-title">
            <span className="live-dot" aria-hidden="true" /> {t('streamsTitle')}
            {total > 0 && <span className="streams-count">{total}</span>}
          </h1>
          <p className="streams-sub">{t('streamsSubtitle')}</p>
        </div>
        <Link href="/live" className="streams-go-live">
          <span className="sidebar-live-icon" aria-hidden="true" />
          {t('goLiveLink')}
        </Link>
      </div>

      {total > 0 && (
        <div className="streams-filters">
          <div className="search-filter-group" role="radiogroup" aria-label={t('streamsSortLabel')}>
            {SORTS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sort === s} className={`search-chip ${sort === s ? 'active' : ''}`} onClick={() => choose({ sort: s })}>
                {sortLabel[s]}
              </button>
            ))}
          </div>
          {categories.length > 0 && (
            <div className="search-filter-group streams-categories" role="radiogroup" aria-label={t('categoryLabel')}>
              <button type="button" role="radio" aria-checked={!category} className={`search-chip ${!category ? 'active' : ''}`} onClick={() => choose({ category: null })}>
                {t('streamsAllCategories')} <span className="streams-chip-count">{total}</span>
              </button>
              {categories.map(([key, count]) => (
                <button key={key} type="button" role="radio" aria-checked={category === key} className={`search-chip ${category === key ? 'active' : ''}`} onClick={() => choose({ category: key })}>
                  {categoryLabel(key, t)} <span className="streams-chip-count">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {streams === null && !failed ? (
        <div className="live-now-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="streams-skeleton" />
          ))}
        </div>
      ) : failed && streams === null ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('streamsLoadFailed')}</p>
      ) : total === 0 ? (
        <div className="streams-empty panel">
          <span className="streams-empty-icon" aria-hidden="true">
            <span className="sidebar-live-icon" />
          </span>
          <p className="streams-empty-title">{enabled ? t('streamsEmptyTitle') : t('streamsDisabled')}</p>
          <p className="streams-empty-text">{t('streamsEmptyText')}</p>
          <div className="streams-empty-actions">
            <Link href="/live" className="streams-btn primary">
              {t('streamsStart')}
            </Link>
            <Link href="/download" className="streams-btn">
              {t('streamsClipper')}
            </Link>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="streams-empty panel">
          <p className="streams-empty-title">{t('streamsEmptyCategory')}</p>
          <div className="streams-empty-actions">
            <button type="button" className="streams-btn" onClick={() => choose({ category: null })}>
              {t('streamsShowAll')}
            </button>
          </div>
        </div>
      ) : (
        <div className="live-now-grid streams-grid">
          {shown.map((s) => (
            <LiveCard key={s.ownerId} item={s} now={now} showCategory={!category} />
          ))}
        </div>
      )}

      <details className="streams-how">
        <summary>{t('streamsHowTitle')}</summary>
        <p>{t('streamsHowShown')}</p>
        <p>{t('streamsHowOrder')}</p>
        <p>{t('streamsHowSafety')}</p>
      </details>
    </div>
  );
}
