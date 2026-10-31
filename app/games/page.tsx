'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { GENRE_KEYS, gameBySlug, gamesByGenre, searchGames, type Game } from '@/lib/games';
import { loadFollowedGames, loadPopularGames } from '@/lib/gamesData';
import { useLiveList } from '@/lib/useLiveList';
import { videoCountLabel } from '@/lib/plural';
import GameTile from '@/components/GameTile';
import UiIcon from '@/components/UiIcon';

/**
 * Hry: sledované, co se teď vysílá, co se hraje (videa za 30 dní) a celý
 * katalog podle žánru (lib/games.ts). Hledání filtruje rovnou na stránce.
 */
export default function GamesPage() {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState('');
  const [followed, setFollowed] = useState<string[]>([]);
  const [popular, setPopular] = useState<{ game: Game; count: number }[] | null>(null);
  const live = useLiveList();

  useEffect(() => {
    let cancelled = false;
    void loadFollowedGames().then((list) => {
      if (!cancelled) setFollowed(list);
    });
    void loadPopularGames().then((list) => {
      if (!cancelled) setPopular(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Kolik přenosů běží u každé hry (bez skrytých - ty vidí jen majitel a tým Kine).
  const liveGames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of live ?? []) if (s.game && !s.hidden && gameBySlug(s.game)) counts.set(s.game, (counts.get(s.game) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([slug, count]) => ({ game: gameBySlug(slug)!, count }));
  }, [live]);
  const liveCount = (slug: string) => liveGames.find((x) => x.game.slug === slug)?.count ?? 0;
  const liveBadge = (slug: string) => {
    const n = liveCount(slug);
    return n > 0 ? t('gameLiveCount').replace('{count}', String(n)) : null;
  };

  const q = query.trim();
  const results = q ? searchGames(q, 60).map((m) => m.game) : [];
  const followedGames = followed.map((slug) => gameBySlug(slug)).filter((g): g is Game => !!g);

  return (
    <div className="games-page">
      <header className="games-head">
        <div>
          <h1 className="games-title">
            <UiIcon name="gamepad" size={24} />
            {t('navGames')}
          </h1>
          <p className="games-sub">{t('gamesSubtitle')}</p>
        </div>
        <label className="games-search">
          <UiIcon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('gamesSearchPlaceholder')}
            aria-label={t('gamesSearchPlaceholder')}
            maxLength={60}
          />
        </label>
      </header>

      {q ? (
        results.length === 0 ? (
          <p className="games-empty">{t('gamesNoResults')}</p>
        ) : (
          <div className="game-grid">
            {results.map((g) => (
              <GameTile key={g.slug} game={g} badge={liveBadge(g.slug)} live={liveCount(g.slug) > 0} />
            ))}
          </div>
        )
      ) : (
        <>
          {followedGames.length > 0 && (
            <section className="games-section">
              <h2 className="games-section-title">{t('gamesFollowing')}</h2>
              <div className="game-row">
                {followedGames.map((g) => (
                  <GameTile key={g.slug} game={g} badge={liveBadge(g.slug)} live={liveCount(g.slug) > 0} />
                ))}
              </div>
            </section>
          )}

          {liveGames.length > 0 && (
            <section className="games-section">
              <h2 className="games-section-title">
                <span className="live-dot" aria-hidden="true" /> {t('gamesLiveNow')}
              </h2>
              <div className="game-row">
                {liveGames.map(({ game, count }) => (
                  <GameTile key={game.slug} game={game} badge={t('gameLiveCount').replace('{count}', String(count))} live />
                ))}
              </div>
            </section>
          )}

          {popular && popular.length > 0 && (
            <section className="games-section">
              <h2 className="games-section-title">{t('gamesPopular')}</h2>
              <div className="game-row">
                {popular.slice(0, 12).map(({ game, count }) => (
                  <GameTile key={game.slug} game={game} sub={videoCountLabel(count, lang, t)} badge={liveBadge(game.slug)} live={liveCount(game.slug) > 0} />
                ))}
              </div>
            </section>
          )}

          <section className="games-section">
            <h2 className="games-section-title">{t('gamesAll')}</h2>
            {gamesByGenre().map(({ genre, games }) => (
              <div key={genre} className="games-genre">
                <h3 className="games-genre-title">{t(GENRE_KEYS[genre] as any)}</h3>
                <div className="game-grid">
                  {games.map((g) => (
                    <GameTile key={g.slug} game={g} badge={liveBadge(g.slug)} live={liveCount(g.slug) > 0} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
