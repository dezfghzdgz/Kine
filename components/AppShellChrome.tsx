'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import KeyboardShortcuts from './KeyboardShortcuts';
import MusicMiniPlayer from './MusicMiniPlayer';
import UploadProgressBar from './UploadProgressBar';
import AppearanceBackdrop from './AppearanceBackdrop';
import AppearancePattern from './AppearancePattern';

export default function AppShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSparks = pathname === '/sparks';
  const isWatch = pathname.startsWith('/watch/');
  // Vložitelný přehrávač (/embed/<id>) žije v cizím rámu: žádné menu, lišty
  // ani zkratky - jen to, co stránka sama vykreslí.
  const isEmbed = pathname.startsWith('/embed/');
  // Chat přenosu v samostatném okně / překryv pro OBS - taky bez kostry appky.
  const isChatPopout = /^\/live\/[^/]+\/chat$/.test(pathname);

  // iOS Safari zapíná stav :active (barva stisku ve skle, app/globals.css)
  // jen tehdy, když stránka poslouchá dotyk. Prázdný posluchač stačí.
  useEffect(() => {
    const nic = () => {};
    document.addEventListener('touchstart', nic, { passive: true });
    return () => document.removeEventListener('touchstart', nic);
  }, []);

  if (isEmbed || isChatPopout) return <>{children}</>;

  return (
    <div className="app-shell">
      {/* Skleněný vzhled: barevné rozmazané pozadí za celou appkou (Nastavení -> Vzhled). */}
      <AppearanceBackdrop />
      {/* Vzor přes pozadí (tečky, mřížka... nebo vlastní obrázek) - Nastavení -> Vzhled -> Vzor. */}
      <AppearancePattern />
      {/* Zkratky visí nad celou appkou, ne na jedné stránce. Na Sparks se
          vypínají úplně (mají vlastní ovládání šipkami) a u přehrávače se
          vypíná jen posun mezi kartami - tam "K" znamená přehrát/pauza,
          stejně jako na YouTube. */}
      {!isSparks && <KeyboardShortcuts cardNavigation={!isWatch} playerShortcuts={isWatch} />}

      {/* Lišta s hudbou. Sama se schová, když nic nehraje nebo když
          stránka videa ukazuje velký obal té samé skladby. */}
      <UploadProgressBar />
      <MusicMiniPlayer />
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
