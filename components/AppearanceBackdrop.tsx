'use client';

import { useEffect, useRef, useState } from 'react';
import { APPEARANCE_EVENT, APPEARANCE_KEY, THEME_KEY, currentAmbientSource, onAmbientSource, readAppearance, type Appearance } from '@/lib/appearance';

/** Adresa obrázku do CSS url("...") - uvozovky a zpětná lomítka by CSS rozbily. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

/**
 * Barevné rozmazané pozadí pro skleněný vzhled (lib/appearance.ts). Leží
 * za celou appkou (position: fixed, z-index -1), plochy nad ním jsou
 * průhledné. "Podle videa" = rozmazaný náhled toho, na co se díváš
 * (jako ambientní režim YouTube nebo pozadí z obalu v upraveném
 * Spotify); jinde přechod v barvě, kterou si vybereš.
 *
 * Rozmazání (filter: blur) má jen tahle jedna vrstva a jen jednou - plochy
 * nad ní nic rozmazávat nemusí, sklo vypadá jako sklo i bez drahého
 * backdrop-filter na každé kartě. V klasickém vzhledu se nevykreslí nic.
 */
export default function AppearanceBackdrop() {
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  const [image, setImage] = useState<string | null>(null);
  // Předchozí obrázek zůstane chvíli pod novým - přechod mezi videi je plynulý, ne bliknutí.
  const [previous, setPrevious] = useState<string | null>(null);
  const imageRef = useRef<string | null>(null);

  useEffect(() => {
    const sync = () => setAppearance(readAppearance());
    sync();
    imageRef.current = currentAmbientSource();
    setImage(imageRef.current);
    window.addEventListener(APPEARANCE_EVENT, sync);
    // Vzhled změněný v jiné kartě prohlížeče.
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY || e.key === THEME_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    const off = onAmbientSource((url) => {
      const current = imageRef.current;
      if (current === url) return;
      imageRef.current = url;
      setPrevious(current);
      setImage(url);
    });
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
      off();
    };
  }, []);

  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), 900);
    return () => clearTimeout(timer);
  }, [previous]);

  if (!appearance || appearance.look !== 'glass') return null;
  const fromVideo = appearance.backdrop === 'auto';

  return (
    <div className="kine-backdrop" aria-hidden="true">
      <div className="kine-backdrop-layer kine-backdrop-gradient" />
      {fromVideo && previous && previous !== image && (
        <div key={`prev-${previous}`} className="kine-backdrop-layer kine-backdrop-image kine-backdrop-image-out" style={{ backgroundImage: cssUrl(previous) }} />
      )}
      {fromVideo && image && <div key={image} className="kine-backdrop-layer kine-backdrop-image" style={{ backgroundImage: cssUrl(image) }} />}
      <div className="kine-backdrop-tint" />
    </div>
  );
}
