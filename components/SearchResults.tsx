'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import { CATEGORY_KEYS } from '@/lib/categories';
import VideoCard from './VideoCard';
import { formatDuration } from '@/lib/homeRecommendation';
import { DEFAULT_FILTERS, searchHref, type SearchFilters } from '@/lib/searchFilters';
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
  const router = useRouter();

  if (!query) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('searchEmptyPrompt')}</p>;
  }

  // Přepínače filtrů (jako na YouTube): odkaz s upraveným parametrem, hledá server.
  const groups: { key: keyof SearchFilters; label: string; options: { value: string; label: string }[] }[] = [
    {
      key: 'type',
      label: t('searchFilterType'),
      options: [
        { value: 'all', label: t('contentTypeAll') },
        { value: 'long', label: t('contentTypeVideos') },
        { value: 'sparks', label: t('contentTypeSparks') },
      ],
    },
    {
      key: 'date',
      label: t('searchFilterDate'),
      options: [
        { value: 'any', label: t('searchFilterAny') },
        { value: 'hour', label: t('searchDateHour') },
        { value: 'today', label: t('searchDateToday') },
        { value: 'week', label: t('searchDateWeek') },
        { value: 'month', label: t('searchDateMonth') },
        { value: 'year', label: t('searchDateYear') },
      ],
    },
    {
      key: 'duration',
      label: t('searchFilterDuration'),
      options: [
        { value: 'any', label: t('searchDurationAny') },
        { value: 'short', label: t('searchDurationShort') },
        { value: 'medium', label: t('searchDurationMedium') },
        { value: 'long', label: t('searchDurationLong') },
      ],
    },
    {
      key: 'sort',
      label: t('searchFilterSort'),
      options: [
        { value: 'relevance', label: t('searchSortRelevance') },
        { value: 'date', label: t('searchSortDate') },
        { value: 'views', label: t('searchSortViews') },
      ],
    },
  ];

  return (
    <div>
      <p className="section-title">{t('searchResultsFor').replace('{query}', query)}</p>

      <div className="search-filters" role="group" aria-label={t('advancedSearch')}>
        {groups.map((g) => (
          <div key={g.key} className="search-filter-group">
            <span className="search-filter-label">{g.label}</span>
            {g.options.map((o) => (
              <Link
                key={o.value}
                href={searchHref(query, filters, { [g.key]: o.value } as Partial<SearchFilters>, minRating)}
                className={`search-chip ${filters[g.key] === o.value ? 'active' : ''}`}
                aria-current={filters[g.key] === o.value ? 'true' : undefined}
                scroll={false}
              >
                {o.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="search-filter-group">
          <span className="search-filter-label">{t('searchFilterCreators')}</span>
          <Link href={searchHref(query, filters, {}, null)} className={`search-chip ${!minRating ? 'active' : ''}`} aria-current={!minRating ? 'true' : undefined} scroll={false}>
            {t('searchRatingAny')}
          </Link>
          <Link
            href={searchHref(query, filters, {}, '80')}
            className={`search-chip ${minRating ? 'active' : ''}`}
            aria-current={minRating ? 'true' : undefined}
            title={t('highRatingOnly')}
            scroll={false}
          >
            {t('searchRating80')}
          </Link>
        </div>
        <div className="search-filter-group">
          <span className="search-filter-label">{t('searchFilterCategory')}</span>
          {/* 15 kategorií by jako přepínače zabraly tři řádky - proto výběr. */}
          <select
            className="search-category-select"
            value={filters.category}
            onChange={(e) => router.push(searchHref(query, filters, { category: e.target.value }, minRating), { scroll: false })}
            aria-label={t('searchFilterCategory')}
          >
            <option value="any">{t('searchCategoryAny')}</option>
            {[...CATEGORY_KEYS]
              .sort((a, b) => t(a).localeCompare(t(b)))
              .map((key) => (
                <option key={key} value={key}>
                  {t(key)}
                </option>
              ))}
          </select>
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
