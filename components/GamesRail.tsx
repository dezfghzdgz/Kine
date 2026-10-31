'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { GAMES, type Game } from '@/lib/games';
import { loadPopularGames } from '@/lib/gamesData';
import { videoCountLabel } from '@/lib/plural';
import GameTile from './GameTile';

/**
 * Řada her nad videi kategorie Hry (Explore): co se teď hraje nejvíc,
 * dokud nic není, prvních pár z katalogu. Vede na stránky her a /games.
 */
export default function GamesRail() {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<{ game: Game; count: number | null }[]>(() => GAMES.slice(0, 10).map((game) => ({ game, count: null })));

  useEffect(() => {
    let cancelled = false;
    loadPopularGames().then((list) => {
      if (cancelled || list.length === 0) return;
      // Doplnit katalogem, ať je řada plná i s pár hrami s videi.
      const seen = new Set(list.map((x) => x.game.slug));
      const rest = GAMES.filter((g) => !seen.has(g.slug)).map((game) => ({ game, count: null as number | null }));
      setItems([...list.map((x) => ({ game: x.game, count: x.count as number | null })), ...rest].slice(0, 10));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="games-rail" aria-label={t('navGames')}>
      <div className="games-rail-head">
        <p className="panel-heading" style={{ margin: 0 }}>
          {t('gamesBrowseByGame')}
        </p>
        <Link href="/games" className="games-rail-all">
          {t('gamesAllLink')} →
        </Link>
      </div>
      <div className="game-row">
        {items.map(({ game, count }) => (
          <GameTile key={game.slug} game={game} sub={count ? videoCountLabel(count, lang, t) : null} />
        ))}
      </div>
    </section>
  );
}
