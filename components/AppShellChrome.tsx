'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isSparks = pathname === '/sparks';
  const isWatch = pathname.startsWith('/watch/');

  useEffect(() => {
    // Dokud uživatel nezadal kód z emailu, appka ho posílá zpátky na tu
    // stránku ať se přes žádný odkaz v liště nedostane dál.
    const pending2fa = sessionStorage.getItem('kine-pending-2fa-email');
    if (pending2fa && pathname !== '/login/verify-2fa') {
      router.replace('/login/verify-2fa');
    }
  }, [pathname, router]);

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
