'use client';

import { useEffect } from 'react';
import { applyTvMode, isTvMode, TV_CHANGE_EVENT } from '@/lib/tvMode';
import { installSpatialNavigation } from '@/lib/spatialNav';

/**
 * Zapíná režim televize (lib/tvMode.ts) a navigaci šipkami
 * (lib/spatialNav.ts). Sedí v kostře appky, nic nevykresluje.
 *
 * V přehrávači, když je vybraný, si šipky doleva/doprava nechává on
 * (posun ve videu); nahoru/dolů z něj vedou pryč - hlasitost má na
 * televizi ovladač, ne appka.
 */
export default function TvMode() {
  useEffect(() => {
    applyTvMode();

    const stop = installSpatialNavigation({
      isActive: isTvMode,
      shouldHandle: (active, dir) => {
        const inPlayer = !!active?.closest('.player-wrap');
        return !inPlayer || dir === 'up' || dir === 'down';
      },
    });

    const onChange = () => applyTvMode();
    window.addEventListener(TV_CHANGE_EVENT, onChange);
    window.addEventListener('storage', onChange);

    return () => {
      stop();
      window.removeEventListener(TV_CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return null;
}
