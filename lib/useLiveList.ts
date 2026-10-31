'use client';

import { useEffect, useState } from 'react';
import { authHeaders, cacheableUrl } from './authHeaders';
import { recentLiveList, type LiveItem } from '@/components/LiveNowRow';

/**
 * Kdo teď vysílá - celý seznam (stránky her: kdo hraje kterou hru).
 * Napřed poslední známý seznam (hlavní stránka / Živě), pak čerstvý;
 * obnova každých 30 s, jen když je karta vidět. null = ještě nevíme.
 */
export function useLiveList(): LiveItem[] | null {
  const [streams, setStreams] = useState<LiveItem[] | null>(() => recentLiveList()?.streams ?? null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.hidden) return;
      try {
        const headers = await authHeaders();
        const res = await fetch(cacheableUrl('/api/live/now?limit=60', headers), { cache: 'no-store', headers });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && body && Array.isArray(body.streams)) setStreams(body.streams);
        else setStreams((s) => s ?? []);
      } catch {
        if (!cancelled) setStreams((s) => s ?? []);
      }
    }
    void load();
    const timer = setInterval(load, 30 * 1000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return streams;
}
