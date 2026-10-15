'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { formatTipAmount } from '@/lib/liveTips';
import { readChatMeta } from '@/lib/chatEmotes';
import { useChatEmotes } from '@/lib/useChatEmotes';
import ProfileImage from './ProfileImage';
import UiIcon from './UiIcon';
import { ChatBody, ChatName } from './ChatText';

type ReplayMessage = {
  id: number;
  body: string;
  created_at: string;
  /** Podpora ve vysílání (zvýrazněná, s částkou) - jen s migrací podpory-kontrola. */
  kind?: string | null;
  tip_amount_cents?: number | null;
  tip_currency?: string | null;
  /** Odznaky, barva jména, odpověď (migrace chat-emoty). */
  meta?: unknown;
  user_id?: string;
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
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<ReplayMessage[] | null>(null);
  const [time, setTime] = useState(0);
  const [hidden, setHidden] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const startMs = new Date(startedAt).getTime();
  const emotes = useChatEmotes(room);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const end = new Date(startMs + (durationSeconds && durationSeconds > 0 ? durationSeconds + 120 : 12 * 3600) * 1000).toISOString();
      const all: ReplayMessage[] = [];
      // Se sloupci pro podpory a odznaky; stará databáze bez nich -> jednodušší výběr.
      let fields = 'id, user_id, body, created_at, kind, tip_amount_cents, tip_currency, meta, profiles(username, avatar_url)';
      for (let from = 0; from < MAX_MESSAGES; from += PAGE) {
        const page = () =>
          supabase
            .from('live_chat_messages')
            .select(fields)
            .eq('room', room)
            .gte('created_at', new Date(startMs - 60 * 1000).toISOString())
            .lte('created_at', end)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
        let { data, error } = await page();
        if (error && from === 0 && /meta/i.test(error.message ?? '')) {
          fields = 'id, user_id, body, created_at, kind, tip_amount_cents, tip_currency, profiles(username, avatar_url)';
          ({ data, error } = await page());
        }
        if (error && from === 0 && /kind|tip_amount|tip_currency|column/i.test(error.message ?? '')) {
          fields = 'id, user_id, body, created_at, profiles(username, avatar_url)';
          ({ data, error } = await page());
        }
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
        <span className="live-chat-head-title">
          <UiIcon name="chat" size={15} />
          {t('chatReplayHeading')}
        </span>
        <button type="button" className="live-chat-icon-btn" onClick={() => setHidden((v) => !v)} aria-expanded={!hidden} title={hidden ? t('chatReplayShow') : t('chatReplayHide')}>
          {hidden ? '▾' : '▴'}
        </button>
      </div>
      {!hidden && (
        <div ref={listRef} className="live-chat-list" aria-live="off">
          {messages === null && <p className="live-chat-empty">{t('loading')}</p>}
          {messages !== null && shown.length === 0 && <p className="live-chat-empty">{t('chatReplayEmpty')}</p>}
          {shown.map((m) => {
            const tip = m.kind === 'tip' && m.tip_amount_cents && m.tip_currency ? formatTipAmount(m.tip_amount_cents, m.tip_currency, lang) : null;
            const meta = readChatMeta(m.meta);
            return (
              <div key={m.id} className={`live-chat-msg ${tip ? 'tip' : ''} ${meta.me ? 'action' : ''}`} data-anim-scope>
                <span className="live-chat-avatar" aria-hidden="true">
                  {m.profiles?.avatar_url ? <ProfileImage src={m.profiles.avatar_url} /> : null}
                </span>
                <span className="live-chat-text">
                  {meta.r && (
                    <span className="chat-reply-ref">
                      <UiIcon name="reply" size={11} />
                      <span className="chat-reply-name">@{meta.r.u || '—'}</span>
                      <span className="chat-reply-snippet">{meta.r.t}</span>
                    </span>
                  )}
                  <ChatName userId={m.user_id ?? String(m.id)} name={m.profiles?.username ?? '—'} meta={meta} />
                  {tip && <span className="live-chat-tip-amount">💛 {tip}</span>}
                  {tip && m.body === '💛' ? null : <ChatBody body={m.body} emotes={emotes.map} />}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
