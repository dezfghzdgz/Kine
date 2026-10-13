'use client';

import { useEffect, useState } from 'react';
import { APPEARANCE_EVENT, APPEARANCE_KEY, PATTERN_IMAGE_KEY, readAppearance, readPatternImage, type Pattern } from '@/lib/appearance';

/**
 * Vzor přes pozadí celé appky (Nastavení -> Vzhled -> Vzor): tečky, mřížka,
 * vlnky... v barvě appky, nebo vlastní obrázek jako dlaždice. Leží za
 * obsahem (position: fixed, z-index -1) - v klasickém vzhledu prosvítá
 * mezi plochami, ve skleněném i skrz ně. Vzory jsou masky (CSS mask), takže
 * se samy přebarví, když si člověk změní barvu appky.
 */
export default function AppearancePattern() {
  const [pattern, setPattern] = useState<Pattern>('none');
  const [custom, setCustom] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setPattern(readAppearance().pattern);
      setCustom(readPatternImage());
    };
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY || e.key === PATTERN_IMAGE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (pattern === 'none') return null;
  if (pattern === 'custom') {
    if (!custom) return null;
    return <div className="kine-pattern kine-pattern-custom" aria-hidden="true" style={{ backgroundImage: `url(${custom})` }} />;
  }
  return <div className={`kine-pattern kine-pattern-${pattern}`} aria-hidden="true" />;
}
