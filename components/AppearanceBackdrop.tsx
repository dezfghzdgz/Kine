'use client';

import { useEffect, useState } from 'react';
import {
  APPEARANCE_EVENT,
  APPEARANCE_KEY,
  BACKDROP_IMAGE_KEY,
  THEME_KEY,
  currentAmbientSource,
  onAmbientSource,
  readAppearance,
  readBackdropImage,
  type Appearance,
} from '@/lib/appearance';
import AmbientCanvas from './AmbientCanvas';

/**
 * Barevné rozmazané pozadí pro skleněný vzhled (lib/appearance.ts). Leží
 * za celou appkou (position: fixed, z-index -1), plochy nad ním jsou
 * průhledné. "Podle videa" = rozmazaný náhled toho, na co se díváš
 * (jako ambientní režim YouTube nebo pozadí z obalu v upraveném
 * Spotify); "můj obrázek" = vlastní tapeta (rozmazaná, jak si kdo nastaví);
 * jinde přechod v barvě, kterou si vybereš.
 *
 * Rozmazání (filter: blur) má jen tahle jedna vrstva a jen jednou - plochy
 * nad ní nic rozmazávat nemusí, sklo vypadá jako sklo i bez drahého
 * backdrop-filter na každé kartě. V klasickém vzhledu se nevykreslí nic.
 */
export default function AppearanceBackdrop() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [custom, setCustom] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setAppearance(readAppearance());
      setCustom(readBackdropImage());
    };
    sync();
    setImage(currentAmbientSource());
    window.addEventListener(APPEARANCE_EVENT, sync);
    // Vzhled změněný v jiné kartě prohlížeče.
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY || e.key === THEME_KEY || e.key === BACKDROP_IMAGE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    const off = onAmbientSource((url) => setImage(url));
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
      off();
    };
  }, []);

  if (!appearance || appearance.look !== 'glass') return null;
  const fromVideo = appearance.backdrop === 'auto';
  // Můj obrázek; dokud žádný není, zůstane přechod v mojí barvě.
  const wallpaper = appearance.backdrop === 'image' ? custom : null;

  return (
    <div className="kine-backdrop" aria-hidden="true">
      <div className="kine-backdrop-layer kine-backdrop-gradient" />
      {/* Snímky (náhled, místo přehrávání) se na plátně plynule přelévají - žádné skoky ani bliknutí. */}
      {fromVideo && image && (
        <div className="kine-backdrop-layer kine-backdrop-image">
          <AmbientCanvas src={image} />
        </div>
      )}
      {wallpaper && <div className="kine-backdrop-layer kine-backdrop-custom" style={{ backgroundImage: `url(${wallpaper})` }} />}
      <div className="kine-backdrop-tint" />
    </div>
  );
}
