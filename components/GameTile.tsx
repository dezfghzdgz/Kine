import Link from 'next/link';
import type { CSSProperties } from 'react';
import { gameMonogram, type Game } from '@/lib/games';

/**
 * Dlaždice hry (stránka /games, řada her v Explore, podobné hry): barva
 * hry, velké iniciály a název - žádná loga ani obrázky her, jen jméno.
 * `badge` = štítek nahoře ("3 živě"), `sub` = řádek pod názvem.
 */
export default function GameTile({
  game,
  sub,
  badge,
  live = false,
  className = '',
}: {
  game: Game;
  sub?: string | null;
  badge?: string | null;
  live?: boolean;
  className?: string;
}) {
  const mono = gameMonogram(game);
  return (
    <Link href={`/game/${game.slug}`} className={`game-tile ${className}`.trim()} style={{ '--game-color': game.color } as CSSProperties}>
      <span className="game-tile-art" aria-hidden="true">
        <span className="game-tile-mono" data-len={mono.length}>
          {mono}
        </span>
      </span>
      {badge && <span className={`game-tile-badge${live ? ' live' : ''}`}>{badge}</span>}
      <span className="game-tile-text">
        <span className="game-tile-name">{game.name}</span>
        {sub && <span className="game-tile-sub">{sub}</span>}
      </span>
    </Link>
  );
}
