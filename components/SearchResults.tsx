'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import VideoCard from './VideoCard';
import { formatDuration } from '@/lib/homeRecommendation';

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
}: {
  query: string;
  videos: any[];
  creators: any[];
  recommended: any[];
}) {
  const { t } = useLanguage();

  if (!query) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('searchEmptyPrompt')}</p>;
  }

  return (
    <div>
      <p className="section-title">{t('searchResultsFor').replace('{query}', query)}</p>

      {creators.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <p className="panel-heading">{t('searchCreatorsHeading')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
            {creators.map((c: any) => (
              <Link key={c.id} href={`/channel/${c.id}`} className="sidebar-link" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="profile-avatar-small">
                  {c.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img loading="lazy" decoding="async" src={c.avatar_url} alt="" />
                  ) : null}
                </span>
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
