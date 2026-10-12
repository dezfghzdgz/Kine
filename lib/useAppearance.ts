'use client';

import { useEffect, useState } from 'react';
import { APPEARANCE_EVENT, APPEARANCE_KEY, DEFAULT_APPEARANCE, readAppearance, type Appearance } from './appearance';

/** Aktuální vzhled (lib/appearance.ts) - změna v nastavení nebo v jiné kartě se projeví hned. */
export function useAppearance(): Appearance {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  useEffect(() => {
    const sync = () => setAppearance(readAppearance());
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    const onStorage = (e: StorageEvent) => {
      if (e.key === APPEARANCE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return appearance;
}
