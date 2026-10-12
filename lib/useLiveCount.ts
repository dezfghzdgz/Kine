'use client';

import { useEffect, useState } from 'react';

/**
 * Kolik kanálů teď vysílá - číslo u odkazu Živě v menu. Bez přihlášení, ať
 * odpověď jde z mezipaměti CDN (/api/live/now?countOnly=1, 30 s) a menu
 * na každé stránce nezatěžuje databázi. Obnovuje se jednou za minutu,
 * jen když je karta prohlížeče vidět.
 */
export function useLiveCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/live/now?countOnly=1');
        const body = await res.json().catch(() => null);
        if (!cancelled && body && typeof body.count === 'number') setCount(body.count);
      } catch {
        // Bez sítě se číslo jen neukáže.
      }
    }
    load();
    const timer = setInterval(load, 60 * 1000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return count;
}
