import { notFound } from 'next/navigation';
import { gameBySlug } from '@/lib/games';
import GameView from '@/components/GameView';

/**
 * Stránka hry: videa, přenosy a sledování (components/GameView.tsx).
 * Neznámá hra = 404. Stránka se připraví při první návštěvě a hodinu se
 * drží (revalidate v layout.tsx) - při sestavení se nic nestahuje.
 */
export default function GamePage({ params }: { params: { slug: string } }) {
  if (!gameBySlug(params.slug)) notFound();
  return <GameView slug={params.slug} />;
}
