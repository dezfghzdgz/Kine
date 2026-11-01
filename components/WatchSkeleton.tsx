'use client';

import KineLoader from './KineLoader';
import { useLanguage } from '@/lib/i18n';
import { videoPeek } from '@/lib/videoPeek';

/**
 * Stránka videa, než dojdou údaje: stejné rozložení jako hotová stránka
 * (přehrávač, název, sloupec vedle), na místě přehrávače náhled videa
 * z karty, na kterou divák klikl (lib/videoPeek.ts), a kolečko.
 *
 * Dřív tu bylo jen "Načítání…" na prázdné tmavé ploše: stránka po
 * kliknutí zčernala a pak naskočila celá najednou. Teď se mění jen to,
 * co přibude - přehrávač zůstane na stejném místě se stejným obrázkem.
 * Ukazuje se i během přechodu na stránku (app/watch/loading.tsx).
 */
export default function WatchSkeleton({ videoId }: { videoId: string | null }) {
  const { t } = useLanguage();
  const peek = videoPeek(videoId);
  const vertical = !!peek?.vertical;

  return (
    <div className="watch-layout watch-skeleton" aria-busy="true">
      <div className="watch-video-column">
        <div className="player-dock">
          <div className={`player-wrap ${vertical ? 'player-wrap-vertical' : ''}`} style={vertical ? {} : { aspectRatio: '16/9' }}>
            {peek?.thumbnail && (
              <div
                className="player-poster"
                style={{
                  position: 'absolute', inset: 0, zIndex: 5,
                  backgroundImage: `url(${peek.thumbnail})`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                }}
              />
            )}
            <div className="player-loading">
              <KineLoader label={t('loading')} />
            </div>
          </div>
        </div>
        {peek?.title ? (
          <h1 className="video-title">{peek.title}</h1>
        ) : (
          <div className="skeleton-line skeleton-shimmer watch-skeleton-title" aria-hidden="true" />
        )}
        <div className="watch-skeleton-meta" aria-hidden="true">
          <span className="watch-skeleton-avatar skeleton-shimmer" />
          <span className="skeleton-line skeleton-shimmer" style={{ width: peek?.creator ? '22%' : '30%' }} />
        </div>
      </div>
      <div className="watch-comments-column watch-skeleton-side" aria-hidden="true">
        <div className="skeleton-line skeleton-shimmer" style={{ width: '45%' }} />
        <div className="skeleton-line skeleton-shimmer" style={{ width: '85%' }} />
        <div className="skeleton-line skeleton-shimmer" style={{ width: '70%' }} />
      </div>
    </div>
  );
}
