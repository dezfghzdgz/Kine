'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { isCategoryKey } from '@/lib/categories';
import VideoCard from './VideoCard';
import { formatDuration } from '@/lib/homeRecommendation';
import { DEFAULT_FILTERS, OPEN_SEARCH_FILTERS_EVENT, searchHref, type SearchFilters } from '@/lib/searchFilters';
import UiIcon from './UiIcon';
import ProfileImage from './ProfileImage';

/**
 * Výsledky hledání (app/search/page.tsx).
 *
 * Hledá server (databázové funkce search_videos / search_creators), ale
 * jazyk si divák volí v prohlížeči a server o něm neví. Proto se výsledky
 * kreslí až tady, na straně prohlížeče: nadpisy a hlášky jdou přes
 * překlad jako všude jinde. Dřív byla půlka stránky česky natvrdo a
 * druhá půlka anglicky ("Type something to search for.", "unknown
 * creator", "views") - ať měl divák zvolený jazyk jakýkoliv.
 *
 * Karty videí jsou ty samé jako na hlavní stránce: náhled po najetí,
 * délka, nabídka ⋮ (fronta, uložit, playlist, nahlásit...). Dřív měla
 * stránka hledání vlastní zjednodušené karty bez toho všeho.
 */
export default function SearchResults({
  query,
  videos,
  creators,
  recommended,
  filters = DEFAULT_FILTERS,
  minRating = null,
}: {
  query: string;
  videos: any[];
  creators: any[];
  recommended: any[];
  filters?: SearchFilters;
  minRating?: string | null;
}) {
  const { t } = useLanguage();

  if (!query) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('searchEmptyPrompt')}</p>;
  }

  // Názvy hodnot filtrů - na stránce jsou jen ty zapnuté (jako čipy s křížkem),
  // celé nastavení je v panelu u pole hledání (components/TopBar.tsx). Dřív tu byl
  // celý blok přepínačů na šest řádků a stránka byla hlavně text.
  const labels: Record<keyof SearchFilters, Record<string, string>> = {
    type: { long: t('contentTypeVideos'), sparks: t('contentTypeSparks') },
    date: {
      hour: t('searchDateHour'),
      today: t('searchDateToday'),
      week: t('searchDateWeek'),
      month: t('searchDateMonth'),
      year: t('searchDateYear'),
    },
    duration: { short: t('searchDurationShort'), medium: t('searchDurationMedium'), long: t('searchDurationLong') },
    sort: { date: t('searchSortDate'), views: t('searchSortViews') },
    category: {},
  };
  const chips: { key: string; label: string; href: string; sort?: boolean }[] = [];
  for (const key of ['type', 'date', 'duration', 'sort', 'category'] as (keyof SearchFilters)[]) {
    const value = filters[key];
    if (value === DEFAULT_FILTERS[key]) continue;
    const label = key === 'category' ? (isCategoryKey(value) ? t(value) : value) : labels[key][value] ?? value;
    chips.push({ key, label, href: searchHref(query, filters, { [key]: DEFAULT_FILTERS[key] } as Partial<SearchFilters>, minRating), sort: key === 'sort' });
  }
  if (minRating) chips.unshift({ key: 'rating', label: t('searchRating80'), href: searchHref(query, filters, {}, null) });

  return (
    <div>
      <div className="search-results-head">
        <p className="section-title">{t('searchResultsFor').replace('{query}', query)}</p>
        <div className="search-active-filters" role="group" aria-label={t('advancedSearch')}>
          {chips.map((c) => (
            <Link key={c.key} href={c.href} className="search-chip active search-chip-removable" scroll={false} title={t('searchRemoveFilter')}>
              {c.sort && <UiIcon name="sort" size={13} />}
              {c.label}
              <UiIcon name="close" size={12} />
            </Link>
          ))}
          {chips.length > 1 && (
            <Link href={searchHref(query, DEFAULT_FILTERS, {}, null)} className="search-clear-filters" scroll={false}>
              {t('searchResetFilters')}
            </Link>
          )}
          <button
            type="button"
            className="search-filters-open"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_SEARCH_FILTERS_EVENT))}
            aria-label={t('advancedSearch')}
            title={t('advancedSearch')}
          >
            <UiIcon name="sliders" size={15} />
            {chips.length === 0 && <span>{t('searchFiltersButton')}</span>}
          </button>
        </div>
      </div>

      {creators.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <p className="panel-heading">{t('searchCreatorsHeading')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
            {creators.map((c: any) => (
              <Link key={c.id} href={`/channel/${c.id}`} className="sidebar-link" style={{ display: 'flex', alignItems: 'center', gap: 10 }} data-anim-scope>
                <span className="profile-avatar-small">{c.avatar_url ? <ProfileImage src={c.avatar_url} /> : null}</span>
                {c.display_name ?? c.username}
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="panel-heading">{t('videosTab')}</p>
      {videos.length === 0 ? (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 16, marginBottom: 28 }}>
            {t('searchNoVideosSuggest').replace('{query}', query)}
          </p>
          <div className="video-grid">
            {recommended.map((v: any) => (
              <VideoCard key={v.id} video={v} href={`/watch/${v.id}`} formatDuration={formatDuration} />
            ))}
          </div>
        </>
      ) : (
        <div className="video-grid">
          {videos.map((v: any) => (
            <VideoCard key={v.id} video={v} href={`/watch/${v.id}`} formatDuration={formatDuration} />
          ))}
        </div>
      )}
    </div>
  );
}
