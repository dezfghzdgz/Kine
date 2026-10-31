import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Game } from '@/lib/games';
import UiIcon from './UiIcon';

/**
 * Štítek hry u videa a přenosu - odkaz na stránku hry (/game/[slug]).
 * Uvnitř jiného odkazu (karta přenosu) se kreslí jen jako text (`plain`),
 * odkaz v odkazu HTML nedovolí.
 */
export default function GameChip({ game, plain = false, className = '' }: { game: Game; plain?: boolean; className?: string }) {
  const style = { '--game-color': game.color } as CSSProperties;
  const inner = (
    <>
      <span className="game-chip-dot" aria-hidden="true" />
      <UiIcon name="gamepad" size={14} />
      <span className="game-chip-name">{game.name}</span>
    </>
  );
  if (plain) {
    return (
      <span className={`game-chip plain ${className}`.trim()} style={style}>
        {inner}
      </span>
    );
  }
  return (
    <Link href={`/game/${game.slug}`} className={`game-chip ${className}`.trim()} style={style}>
      {inner}
      <UiIcon name="chevronRight" size={12} />
    </Link>
  );
}
