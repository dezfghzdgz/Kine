'use client';

import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSparks = pathname === '/sparks';
  const isWatch = pathname.startsWith('/watch/');

  return (
    <div className="app-shell">
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
