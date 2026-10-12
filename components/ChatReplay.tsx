'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

type ReplayMessage = {
  id: number;
  body: string;
  created_at: string;
  profiles?: { username: string | null; avatar_url: string | null } | null;
  /** Vteřina videa, kdy zpráva padla. */
  at: number;
};

const PAGE = 1000;
const MAX_MESSAGES = 10000;

/**
 * Záznam chatu u videa, které vzniklo ze živého vysílání: zprávy se
 * přehrávají ve chvíli, kdy padly (jako "Chat Replay" na Twitchi a
 * YouTube). Zprávy jsou pořád v live_chat_messages - video si pamatuje
 * jen chat (live_room) a začátek vysílání (live_started_at). Co moderátor
 * smazal, v záznamu není.
 */
export default function ChatReplay({
  room,
  startedAt,
  durationSeconds,
  player,
}: {
  room: string;
  startedAt: string;
  durationSeconds: number | null;
  player: { currentTime?: number } | null;
}) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<ReplayMessage[] | null>(null);
  const [time, setTime] = useState(0);
  const [hidden, setHidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const startMs = new Date(startedAt).getTime();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const end = new Date(startMs + (durationSeconds && durationSeconds > 0 ? durationSeconds + 120 : 12 * 3600) * 1000).toISOString();
      const all: ReplayMessage[] = [];
      for (let from = 0; from < MAX_MESSAGES; from += PAGE) {
        const { data, error } = await supabase
          .from('live_chat_messages')
          .select('id, body, created_at, profiles(username, avatar_url)')
          .eq('room', room)
          .gte('created_at', new Date(startMs - 60 * 1000).toISOString())
          .lte('created_at', end)
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (cancelled || error || !data) break;
        for (const m of data as any[]) all.push({ ...m, at: Math.max(0, (new Date(m.created_at).getTime() - startMs) / 1000) });
        if (data.length < PAGE) break;
      }
      if (!cancelled) setMessages(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [room, startMs, durationSeconds]);

  // Čas přehrávače 2x za vteřinu (přetáčení se projeví hned).
  useEffect(() => {
    if (!player) return;
    const timer = setInterval(() => setTime(Number(player.currentTime ?? 0) || 0), 500);
    return () => clearInterval(timer);
  }, [player]);

  const shown = useMemo(() => {
    if (!messages) return [];
    let hi = messages.length;
    // Zprávy jsou seřazené - poslední, která už padla (binární hledání).
    let lo = 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (messages[mid].at <= time) lo = mid + 1;
      else hi = mid;
    }
    return messages.slice(Math.max(0, lo - 60), lo);
  }, [messages, time]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown.length, shown[shown.length - 1]?.id]);

  if (messages && messages.length === 0) return null;

  return (
    <div className="live-chat chat-replay" style={{ height: hidden ? 'auto' : undefined }}>
      <div className="live-chat-head">
        <span>💬 {t('chatReplayHeading')}</span>
        <button type="button" className="live-chat-icon-btn" onClick={() => setHidden((v) => !v)} aria-expanded={!hidden} title={hidden ? t('chatReplayShow') : t('chatReplayHide')}>
          {hidden ? '▾' : '▴'}
        </button>
      </div>
      {!hidden && (
        <div ref={listRef} className="live-chat-list" aria-live="off">
          {messages === null && <p className="live-chat-empty">{t('loading')}</p>}
          {messages !== null && shown.length === 0 && <p className="live-chat-empty">{t('chatReplayEmpty')}</p>}
          {shown.map((m) => (
            <div key={m.id} className="live-chat-msg">
              <span className="live-chat-avatar" aria-hidden="true">
                {m.profiles?.avatar_url ? <img src={m.profiles.avatar_url} alt="" loading="lazy" decoding="async" /> : null}
              </span>
              <span className="live-chat-text">
                <span className="live-chat-user">{m.profiles?.username ?? '—'}</span>
                {m.body}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
