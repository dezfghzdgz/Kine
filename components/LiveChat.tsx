'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { CHAT_MAX_LENGTH } from '@/lib/liveChat';

type Message = {
  id: number;
  user_id: string;
  body: string;
  created_at: string;
  profiles?: { username: string | null; avatar_url: string | null } | null;
};

/**
 * Chat k živému vysílání nebo premiéře.
 *
 * Čte se přímo z databáze (tabulka je veřejně čitelná) - posledních 80
 * zpráv každé ~3 s, a to jen když je karta vidět. Celý výpis se bere
 * znovu, takže zmizí i zprávy, které mezitím smazal moderátor. Psaní a
 * mazání jde přes /api/live/chat (přihlášení, blokace, tempo).
 */
export default function LiveChat({
  room,
  canModerate = false,
  className = '',
}: {
  room: string;
  /** Majitel kanálu / videa: může mazat cizí zprávy (moderátoři to smí vždycky - rozhodne server). */
  canModerate?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  async function refresh() {
    const { data, error: loadError } = await supabase
      .from('live_chat_messages')
      .select('id, user_id, body, created_at, profiles(username, avatar_url)')
      .eq('room', room)
      .order('id', { ascending: false })
      .limit(80);
    if (loadError) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setMessages(((data ?? []) as any[]).reverse());
  }

  useEffect(() => {
    let cancelled = false;
    refresh();
    const timer = setInterval(() => {
      if (!cancelled && document.visibilityState === 'visible') refresh();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // Nové zprávy dole - ale jen když divák nečte starší (neodroloval nahoru).
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  async function authHeader(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/live/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ room, body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 429 ? t('liveChatTooFast') : json.error ?? t('liveChatUnavailable'));
        return;
      }
      setDraft('');
      stickToBottomRef.current = true;
      await refresh();
    } catch {
      setError(t('liveChatUnavailable'));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: number) {
    setMessages((list) => list.filter((m) => m.id !== id));
    await fetch('/api/live/chat', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }

  return (
    <div className={`live-chat ${className}`}>
      <div className="live-chat-head">{t('liveChatHeading')}</div>
      <div ref={listRef} className="live-chat-list" onScroll={onScroll} aria-live="polite">
        {unavailable && <p className="live-chat-empty">{t('liveChatUnavailable')}</p>}
        {!unavailable && messages.length === 0 && <p className="live-chat-empty">{t('liveChatEmpty')}</p>}
        {messages.map((m) => (
          <div key={m.id} className="live-chat-msg">
            <span className="live-chat-avatar" aria-hidden="true">
              {m.profiles?.avatar_url ? <img src={m.profiles.avatar_url} alt="" loading="lazy" decoding="async" /> : null}
            </span>
            <span className="live-chat-text">
              <span className="live-chat-user">{m.profiles?.username ?? '—'}</span>
              {m.body}
            </span>
            {(canModerate || m.user_id === userId) && (
              <button type="button" className="live-chat-delete" onClick={() => remove(m.id)} aria-label={t('liveChatDelete')} title={t('liveChatDelete')}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {userId ? (
        <form className="live-chat-form" onSubmit={send}>
          <input
            type="text"
            value={draft}
            maxLength={CHAT_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('liveChatPlaceholder')}
            aria-label={t('liveChatPlaceholder')}
            disabled={unavailable}
          />
          <button type="submit" disabled={sending || !draft.trim() || unavailable}>
            {t('liveChatSend')}
          </button>
        </form>
      ) : (
        <p className="live-chat-signin">
          <Link href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/')}`}>{t('liveChatSignIn')}</Link>
        </p>
      )}
      {error && <p className="live-chat-error">{error}</p>}
    </div>
  );
}
