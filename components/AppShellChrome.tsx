'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import KeyboardShortcuts from './KeyboardShortcuts';

export default function AppShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSparks = pathname === '/sparks';
  const isWatch = pathname.startsWith('/watch/');

  return (
    <div className="app-shell">
      {/* Zkratky visí nad celou appkou, ne na jedné stránce. Na Sparks se
          vypínají úplně (mají vlastní ovládání šipkami) a u přehrávače se
          vypíná jen posun mezi kartami - tam "K" znamená přehrát/pauza,
          stejně jako na YouTube. */}
      {!isSparks && <KeyboardShortcuts cardNavigation={!isWatch} />}
      <Sidebar />
      {isSparks ? (
        <div className="content-area-fullbleed">{children}</div>
      ) : (
        <div className={`content-area ${isWatch ? 'content-area-watch' : ''}`}>
          <TopBar />
          {children}
        </div>
      )}
    </div>
  );
}
