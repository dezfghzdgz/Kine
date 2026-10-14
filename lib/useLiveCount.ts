'use client';

import { useEffect, useState } from 'react';

const LIVE_COUNT_EVENT = 'kine:live-count';

/**
 * Stránka, která má čerstvý seznam přenosů (Živě, řada Živě na hlavní
 * stránce), řekne menu, kolik jich je - číslo u odkazu Živě pak sedí se
 * seznamem na obrazovce a nečeká na vlastní dotaz z mezipaměti.
 */
export function announceLiveCount(count: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(count) || count < 0) return;
  window.dispatchEvent(new CustomEvent(LIVE_COUNT_EVENT, { detail: Math.floor(count) }));
}

/**
 * Kolik kanálů teď vysílá - číslo u odkazu Živě v menu. Bez přihlášení, ať
 * odpověď jde z mezipaměti CDN (/api/live/now?countOnly=1, 15 s) a menu
 * na každé stránce nezatěžuje databázi. Obnovuje se každých 30 s, jen když
 * je karta prohlížeče vidět; čerstvý seznam na stránce má přednost
 * (announceLiveCount).
 */
export function useLiveCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // Kdy číslo naposledy přišlo ze stránky se seznamem - chvíli potom má přednost před mezipamětí.
    let announcedAt = 0;
    async function load() {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/live/now?countOnly=1&anon=1');
        const body = await res.json().catch(() => null);
        if (!cancelled && body && typeof body.count === 'number' && Date.now() - announcedAt > 45 * 1000) setCount(body.count);
      } catch {
        // Bez sítě se číslo jen neukáže.
      }
    }
    const onAnnounce = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n !== 'number') return;
      announcedAt = Date.now();
      setCount(n);
    };
    load();
    const timer = setInterval(load, 30 * 1000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(LIVE_COUNT_EVENT, onAnnounce);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(LIVE_COUNT_EVENT, onAnnounce);
    };
  }, []);
  return count;
}
