'use client';

import { usePathname } from 'next/navigation';

/**
 * Obal každé stránky (při přechodu na jinou stránku vzniká znovu).
 *
 * Jemné prolnutí - ne z úplné průhlednosti: z nuly obsah na chvilku úplně
 * zmizel a stránka "zčernala a blikla". Stránka videa se neprolíná vůbec:
 * po kliknutí na video je na místě přehrávače hned náhled
 * (components/WatchSkeleton.tsx) a ten se nemá ztmavovat.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fade = !(pathname ?? '').startsWith('/watch/');
  return <div className={fade ? 'page-transition-fade' : undefined}>{children}</div>;
}
