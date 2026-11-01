'use client';

import { useParams } from 'next/navigation';
import WatchSkeleton from '@/components/WatchSkeleton';

/**
 * Přechod na stránku videa: hned po kliknutí rozložení stránky s náhledem
 * videa (components/WatchSkeleton.tsx) - ne čekání na staré stránce, než
 * server připraví novou, a pak bliknutí.
 */
export default function WatchLoading() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : null;
  return <WatchSkeleton videoId={id} />;
}
