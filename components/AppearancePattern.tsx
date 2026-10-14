'use client';

import { useEffect, useState } from 'react';
import {
  APPEARANCE_EVENT,
  APPEARANCE_KEY,
  PATTERN_IMAGE_KEY,
  PHOTO_STAMP_KEY,
  readAppearance,
  readPatternImage,
  readPhotoBlob,
  stillFrame,
  type Pattern,
} from '@/lib/appearance';

/** Klidný režim (Nastavení -> Vzhled -> Méně pohybu, nebo systém): GIF na pozadí stojí. */
function calmNow(): boolean {
  try {
    return document.documentElement.getAttribute('data-calm') === '1' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Vzor přes pozadí celé appky (Nastavení -> Vzhled -> Vzor): tečky, mřížka,
 * vlnky... v barvě appky, vlastní obrázek jako dlaždice, nebo jedna fotka /
 * GIF přes celé pozadí. Leží za obsahem (position: fixed, z-index -1) -
 * v klasickém vzhledu prosvítá mezi plochami, ve skleněném i skrz ně. Vzory
 * jsou masky (CSS mask), takže se samy přebarví, když si člověk změní barvu appky.
 */
export default function AppearancePattern() {
  const [pattern, setPattern] = useState<Pattern>('none');
  const [custom, setCustom] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  // Změní se jen s novou fotkou (posuvník síly ji nenačítá znovu - pozadí by bliklo).
  const [photoStamp, setPhotoStamp] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setPattern(readAppearance().pattern);
      setCustom(readPatternImage());
      let stamp: string | null = null;
      try {
        stamp = window.localStorage.getItem(PHOTO_STAMP_KEY);
      } catch {
        stamp = null;
      }
      setPhotoStamp(stamp);
    };
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY || e.key === PATTERN_IMAGE_KEY || e.key === PHOTO_STAMP_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Fotka / GIF z IndexedDB -> adresa pro CSS (po změně se stará uvolní).
  useEffect(() => {
    if (pattern !== 'photo') {
      setPhoto(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      const blob = await readPhotoBlob();
      if (cancelled || !blob) {
        if (!cancelled) setPhoto(null);
        return;
      }
      const shown = blob.type === 'image/gif' && calmNow() ? (await stillFrame(blob)) ?? blob : blob;
      if (cancelled) return;
      url = URL.createObjectURL(shown);
      setPhoto(url);
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pattern, photoStamp]);

  if (pattern === 'none') return null;
  if (pattern === 'photo') {
    if (!photo) return null;
    return <div className="kine-pattern kine-pattern-photo" aria-hidden="true" style={{ backgroundImage: `url(${photo})` }} />;
  }
  if (pattern === 'custom') {
    if (!custom) return null;
    return <div className="kine-pattern kine-pattern-custom" aria-hidden="true" style={{ backgroundImage: `url(${custom})` }} />;
  }
  return <div className={`kine-pattern kine-pattern-${pattern}`} aria-hidden="true" />;
}
