'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { emoteMap, type ChatEmote } from './chatEmotes';

/**
 * Emoty kanálu pro chat (a překryv pro OBS, záznam chatu): jednou za
 * načtení stránky z /api/live/chat/emotes (CDN je chvíli drží) a pak
 * každé 2 minuty, když je karta vidět. Emoty Kine jsou v mapě vždycky.
 */

type Loaded = { emotes: ChatEmote[]; ownerId: string | null; available: boolean; at: number };
const cache = new Map<string, Loaded>();
const REFRESH_MS = 2 * 60 * 1000;
const NO_EMOTES: ChatEmote[] = [];
/** Kdo na stránce emoty chatu ukazuje (chat i správa emotů ve studiu) - po změně se dozví všichni. */
const listeners = new Map<string, Set<(loaded: Loaded) => void>>();

function publish(room: string, loaded: Loaded) {
  cache.set(room, loaded);
  for (const fn of listeners.get(room) ?? []) fn(loaded);
}

async function fetchEmotes(room: string, fresh = false): Promise<Loaded | null> {
  try {
    const res = await fetch(`/api/live/chat/emotes?room=${encodeURIComponent(room)}${fresh ? `&t=${Date.now()}` : ''}`);
    if (!res.ok) return null;
    const body = await res.json();
    const emotes = (Array.isArray(body?.emotes) ? body.emotes : []).filter((e: ChatEmote) => e && typeof e.code === 'string' && typeof e.url === 'string');
    return { emotes, ownerId: typeof body?.ownerId === 'string' ? body.ownerId : null, available: body?.available !== false, at: Date.now() };
  } catch {
    return null;
  }
}

export function useChatEmotes(room: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(() => (room ? cache.get(room) ?? null : null));

  const reload = useCallback(
    async (fresh = false) => {
      if (!room) return;
      const next = await fetchEmotes(room, fresh);
      if (!next) return;
      publish(room, next);
    },
    [room]
  );

  useEffect(() => {
    if (!room) return;
    const cached = cache.get(room);
    setLoaded(cached ?? null);
    const set = listeners.get(room) ?? new Set();
    set.add(setLoaded);
    listeners.set(room, set);
    if (!cached || Date.now() - cached.at > REFRESH_MS) void reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      set.delete(setLoaded);
    };
  }, [room, reload]);

  /** Po nahrání / smazání emotu: hned bez čekání na obnovení. */
  const replace = useCallback(
    (emotes: ChatEmote[]) => {
      if (!room) return;
      publish(room, { emotes, ownerId: loaded?.ownerId ?? null, available: true, at: Date.now() });
    },
    [room, loaded?.ownerId]
  );

  const channel = loaded?.emotes ?? NO_EMOTES;
  const map = useMemo(() => emoteMap(channel), [channel]);
  return { channel, map, ownerId: loaded?.ownerId ?? null, available: loaded?.available ?? true, reload, replace };
}
