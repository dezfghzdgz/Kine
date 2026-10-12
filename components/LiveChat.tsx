'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { CHAT_MAX_LENGTH } from '@/lib/liveChat';
import { FOLLOW_MINUTES_OPTIONS, SLOW_MODE_OPTIONS } from '@/lib/liveChatRules';
import { formatTipAmount } from '@/lib/liveTips';
import { ChatSpeaker, TTS_MODES, readTtsMode, saveTtsMode, speechText, type TtsMode } from '@/lib/chatSpeech';

type Message = {
  id: number;
  user_id: string;
  body: string;
  created_at: string;
  /** 'tip' = podpora ve vysílání (zvýrazněná, s částkou). Bez migrace chybí. */
  kind?: string | null;
  tip_amount_cents?: number | null;
  tip_currency?: string | null;
  profiles?: { username: string | null; avatar_url: string | null } | null;
};

const BASE_FIELDS = 'id, user_id, body, created_at, profiles(username, avatar_url)';
const TIP_FIELDS = 'id, user_id, body, created_at, kind, tip_amount_cents, tip_currency, profiles(username, avatar_url)';
/** Má databáze sloupce pro podpory? (null = ještě nevíme) - zjistí se při prvním načtení. */
let tipColumns: boolean | null = null;

/** Podpora: částka (podle jazyka webu). */
function tipLabel(m: Message, lang: string): string | null {
  if (m.kind !== 'tip' || !m.tip_amount_cents || !m.tip_currency) return null;
  return formatTipAmount(m.tip_amount_cents, m.tip_currency, lang);
}

type Rules = {
  available: boolean;
  settings: { slowSeconds: number; followersOnly: boolean; followMinutes: number; blockLinks: boolean; minAccountMinutes: number; shield: boolean };
  role: 'owner' | 'staff' | 'moderator' | 'viewer';
  canModerate: boolean;
  blockedTerms?: string[];
  bans?: { userId: string; username: string | null; until: string | null }[];
};

/**
 * Chat k živému vysílání nebo premiéře.
 *
 * Čte se přímo z databáze (tabulka je veřejně čitelná) - posledních 80
 * zpráv každé ~3 s, a to jen když je karta vidět. Celý výpis se bere
 * znovu, takže zmizí i zprávy, které mezitím smazal moderátor. Psaní,
 * mazání a moderace jdou přes /api/live/chat (přihlášení, blokace, tempo,
 * pravidla chatu - lib/liveChatRules.ts).
 *
 * Podoby: "panel" (u přenosu), "popout" (samostatné okno /live/<id>/chat)
 * a "overlay" (průhledný chat pro OBS - jen zprávy, bez psaní).
 */
export default function LiveChat({
  room,
  canModerate = false,
  className = '',
  variant = 'panel',
  popoutHref,
  tts: ttsFromUrl,
}: {
  room: string;
  /** Majitel kanálu / videa (rozhodne stejně server - tohle jen ukáže tlačítka hned). */
  canModerate?: boolean;
  className?: string;
  variant?: 'panel' | 'popout' | 'overlay';
  /** Odkaz na chat v samostatném okně (ikonka v hlavičce). */
  popoutHref?: string;
  /** Překryv pro OBS: čtení nahlas z adresy (?tts=tips / ?tts=all). */
  tts?: TtsMode;
}) {
  const { t, lang } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [termsDraft, setTermsDraft] = useState('');
  const [actionsFor, setActionsFor] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const overlay = variant === 'overlay';
  const mod = !!rules?.canModerate || canModerate;
  // Čtení nahlas (lib/chatSpeech.ts): režim, předčítač a kam až se už četlo.
  const [ttsMode, setTtsMode] = useState<TtsMode>('off');
  const [ttsMenu, setTtsMenu] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(true);
  const speakerRef = useRef<ChatSpeaker | null>(null);
  const spokenUpToRef = useRef<number | null>(null);

  useEffect(() => {
    setTtsSupported(ChatSpeaker.supported());
    setTtsMode(overlay ? ttsFromUrl ?? 'off' : readTtsMode());
  }, [overlay, ttsFromUrl]);

  useEffect(() => {
    if (ttsMode === 'off') {
      speakerRef.current?.stop();
      return;
    }
    speakerRef.current ??= new ChatSpeaker(lang);
    speakerRef.current.setLang(lang);
  }, [ttsMode, lang]);

  useEffect(() => () => speakerRef.current?.stop(), []);

  // Nové zprávy -> přečíst (jen ty, co přišly po zapnutí; vlastní ne).
  useEffect(() => {
    if (messages.length === 0) return;
    const maxId = messages[messages.length - 1].id;
    const from = spokenUpToRef.current;
    spokenUpToRef.current = Math.max(from ?? 0, maxId);
    if (from === null || ttsMode === 'off' || !speakerRef.current) return;
    const templates = { tip: t('ttsTip'), tipNoMessage: t('ttsTipNoMessage'), chat: t('ttsChat'), link: t('ttsLinkWord') };
    for (const m of messages) {
      if (m.id <= from || m.user_id === userId) continue;
      const text = speechText({ kind: m.kind, name: m.profiles?.username ?? '?', body: m.body, amount: tipLabel(m, lang) }, ttsMode, templates);
      if (text) speakerRef.current.say(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  function changeTts(next: TtsMode) {
    // Zapnutí nečte, co už v chatu je - jen nové.
    if (messages.length > 0) spokenUpToRef.current = messages[messages.length - 1].id;
    setTtsMode(next);
    saveTtsMode(next);
    if (next !== 'off') {
      speakerRef.current ??= new ChatSpeaker(lang);
      // Krátké potvrzení - prohlížeč tím zároveň dostane od kliknutí svolení mluvit.
      speakerRef.current.say(next === 'tips' ? t('ttsOnTips') : t('ttsOnAll'));
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  async function authHeader(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function refresh() {
    const load = (fields: string) =>
      supabase
        .from('live_chat_messages')
        .select(fields)
        .eq('room', room)
        .order('id', { ascending: false })
        .limit(overlay ? 30 : 80);
    let { data, error: loadError } = await load(tipColumns === false ? BASE_FIELDS : TIP_FIELDS);
    if (loadError && tipColumns !== false && /kind|tip_amount|tip_currency|column/i.test(loadError.message ?? '')) {
      // Databáze bez sloupců pro podpory (migrace podpory-kontrola) - chat jede dál bez nich.
      tipColumns = false;
      ({ data, error: loadError } = await load(BASE_FIELDS));
    } else if (!loadError) {
      tipColumns = tipColumns ?? true;
    }
    if (loadError) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setMessages(((data ?? []) as any[]).reverse());
  }

  async function loadRules() {
    try {
      const res = await fetch(`/api/live/chat?room=${encodeURIComponent(room)}`, { headers: await authHeader(), cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as Rules;
      setRules(body);
      if (body.blockedTerms) setTermsDraft((current) => (current ? current : body.blockedTerms!.join(', ')));
    } catch {
      // Bez pravidel se chat ukáže dál, jen bez přehledu režimů.
    }
  }

  useEffect(() => {
    let cancelled = false;
    refresh();
    if (!overlay) loadRules();
    const timer = setInterval(() => {
      if (!cancelled && (overlay || document.visibilityState === 'visible')) refresh();
    }, overlay ? 2000 : 3000);
    const rulesTimer = overlay
      ? null
      : setInterval(() => {
          if (!cancelled && document.visibilityState === 'visible') loadRules();
        }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (rulesTimer) clearInterval(rulesTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, userId]);

  // Nové zprávy dole - ale jen když divák nečte starší (neodroloval nahoru).
  useEffect(() => {
    const list = listRef.current;
    if (list && (stickToBottomRef.current || overlay)) list.scrollTop = list.scrollHeight;
  }, [messages, overlay]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    stickToBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  function durationLabel(minutes: number): string {
    if (minutes >= 1440 && minutes % 1440 === 0) return t('liveChatDays').replace('{n}', String(minutes / 1440));
    if (minutes >= 60 && minutes % 60 === 0) return t('liveChatHours').replace('{n}', String(minutes / 60));
    return t('liveChatMinutes').replace('{n}', String(minutes));
  }

  function rejectionText(body: any): string {
    switch (body?.code) {
      case 'slow':
        return t('liveChatErrSlow').replace('{s}', String(body.seconds ?? 2));
      case 'followers':
        return body.minutes > 0 ? t('liveChatErrFollowersMin').replace('{d}', durationLabel(body.minutes)) : t('liveChatErrFollowers');
      case 'newAccount':
        return t('liveChatErrNewAccount');
      case 'links':
        return t('liveChatErrLinks');
      case 'blocked':
        return t('liveChatErrBlocked');
      case 'banned':
        return t('liveChatErrBanned');
      case 'timeout':
        return t('liveChatErrTimeout').replace('{time}', new Date(body.until).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }));
      default:
        return body?.error ?? t('liveChatUnavailable');
    }
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
        setError(json?.code ? rejectionText(json) : res.status === 429 ? t('liveChatTooFast') : json.error ?? t('liveChatUnavailable'));
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
    setActionsFor(null);
    await fetch('/api/live/chat', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }

  async function moderate(target: string, action: 'timeout' | 'ban' | 'unban', minutes = 10) {
    setActionsFor(null);
    const res = await fetch('/api/live/chat/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ room, userId: target, action, minutes }),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (!res?.ok) setError(json?.error ?? t('liveChatUnavailable'));
    else if (action !== 'unban') setMessages((list) => list.filter((m) => m.user_id !== target));
    await loadRules();
  }

  async function saveRules(patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch('/api/live/chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ room, ...patch }),
    }).catch(() => null);
    const json = await res?.json().catch(() => ({}));
    if (!res?.ok) {
      setError(json?.error ?? t('liveChatUnavailable'));
      return;
    }
    if (json?.blockedTerms) setTermsDraft(json.blockedTerms.join(', '));
    await loadRules();
  }

  const s = rules?.settings;
  const modes: string[] = [];
  if (s?.shield) modes.push('🛡 ' + t('liveChatModeShield'));
  if (s && s.slowSeconds > 0) modes.push('🐢 ' + t('liveChatModeSlow').replace('{d}', t('liveChatSeconds').replace('{n}', String(s.slowSeconds))));
  if (s?.followersOnly) modes.push('👥 ' + t('liveChatModeFollowers'));
  if (s?.blockLinks) modes.push('🔗 ' + t('liveChatModeLinks'));

  if (overlay) {
    return (
      <div className={`live-chat-overlay ${className}`} ref={listRef}>
        {messages.slice(-20).map((m) => {
          const tip = tipLabel(m, lang);
          return (
            <div key={m.id} className={`live-chat-overlay-msg ${tip ? 'tip' : ''}`}>
              <span className="live-chat-user">{m.profiles?.username ?? '—'}</span>
              {tip && <span className="live-chat-tip-amount">💛 {tip}</span>}
              {tip && m.body === '💛' ? null : m.body}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`live-chat ${variant === 'popout' ? 'live-chat-popout' : ''} ${className}`}>
      <div className="live-chat-head">
        <span>{t('liveChatHeading')}</span>
        <span className="live-chat-head-actions">
          <span className="live-chat-tts">
            <button
              type="button"
              className={`live-chat-icon-btn ${ttsMode !== 'off' ? 'active' : ''}`}
              onClick={() => setTtsMenu((v) => !v)}
              title={t('ttsButton')}
              aria-label={t('ttsButton')}
              aria-expanded={ttsMenu}
            >
              {ttsMode === 'off' ? '🔈' : '🔊'}
            </button>
            {ttsMenu && (
              <span className="live-chat-tts-menu" role="menu">
                {!ttsSupported && <span className="live-chat-panel-note">{t('ttsUnsupported')}</span>}
                {TTS_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={ttsMode === m}
                    className={ttsMode === m ? 'active' : ''}
                    disabled={!ttsSupported && m !== 'off'}
                    onClick={() => {
                      changeTts(m);
                      setTtsMenu(false);
                    }}
                  >
                    {m === 'off' ? t('ttsOff') : m === 'tips' ? t('ttsTips') : t('ttsAll')}
                  </button>
                ))}
                {ttsMode !== 'off' && (
                  <button type="button" onClick={() => speakerRef.current?.skip()}>
                    ⏭ {t('ttsSkip')}
                  </button>
                )}
                <span className="live-chat-panel-note">{t('ttsHint')}</span>
              </span>
            )}
          </span>
          {popoutHref && (
            <a
              href={popoutHref}
              target="_blank"
              rel="noopener"
              className="live-chat-icon-btn"
              title={t('liveChatPopout')}
              aria-label={t('liveChatPopout')}
              onClick={(e) => {
                e.preventDefault();
                window.open(popoutHref, `kine-chat-${room.replace(/[^a-z0-9]/gi, '')}`, 'width=420,height=720');
              }}
            >
              ⧉
            </a>
          )}
          {mod && (
            <button
              type="button"
              className={`live-chat-icon-btn ${panelOpen ? 'active' : ''}`}
              onClick={() => setPanelOpen((v) => !v)}
              title={t('liveChatSettings')}
              aria-label={t('liveChatSettings')}
              aria-expanded={panelOpen}
            >
              ⚙
            </button>
          )}
        </span>
      </div>
      {modes.length > 0 && <div className="live-chat-modes">{modes.join(' · ')}</div>}

      {mod && panelOpen && rules && (
        <div className="live-chat-panel">
          {!rules.available && <p className="live-chat-panel-note">{t('liveChatRulesNeedMigration')}</p>}
          <button
            type="button"
            className={`live-chat-shield ${s?.shield ? 'on' : ''}`}
            onClick={() => saveRules({ shield: !s?.shield })}
            disabled={!rules.available}
          >
            🛡 {s?.shield ? t('liveChatShieldOff') : t('liveChatShield')}
          </button>
          <p className="live-chat-panel-note">{t('liveChatShieldHint')}</p>
          <label className="live-chat-panel-row">
            <span>{t('liveChatSlowMode')}</span>
            <select value={s?.slowSeconds ?? 0} onChange={(e) => saveRules({ settings: { slowSeconds: Number(e.target.value) } })} disabled={!rules.available}>
              {SLOW_MODE_OPTIONS.map((sec) => (
                <option key={sec} value={sec}>
                  {sec === 0 ? t('liveChatOff') : t('liveChatSeconds').replace('{n}', String(sec))}
                </option>
              ))}
            </select>
          </label>
          <label className="live-chat-panel-row">
            <span>{t('liveChatFollowersOnly')}</span>
            <select
              value={s?.followersOnly ? String(s.followMinutes) : 'off'}
              onChange={(e) =>
                saveRules({ settings: e.target.value === 'off' ? { followersOnly: false, followMinutes: 0 } : { followersOnly: true, followMinutes: Number(e.target.value) } })
              }
              disabled={!rules.available}
            >
              <option value="off">{t('liveChatFollowersAll')}</option>
              {FOLLOW_MINUTES_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? t('liveChatFollowersAny') : t('liveChatFollowersMin').replace('{d}', durationLabel(m))}
                </option>
              ))}
            </select>
          </label>
          <label className="live-chat-panel-row live-chat-panel-check">
            <input type="checkbox" checked={!!s?.blockLinks} onChange={(e) => saveRules({ settings: { blockLinks: e.target.checked } })} disabled={!rules.available} />
            <span>{t('liveChatBlockLinks')}</span>
          </label>
          <label className="live-chat-panel-col">
            <span>{t('liveChatBlockedTerms')}</span>
            <textarea rows={2} value={termsDraft} onChange={(e) => setTermsDraft(e.target.value)} placeholder={t('liveChatBlockedTermsHint')} disabled={!rules.available} />
          </label>
          <button
            type="button"
            className="live-small-btn"
            onClick={() => saveRules({ settings: { blockedTerms: termsDraft.split(',').map((x) => x.trim()).filter(Boolean) } })}
            disabled={!rules.available}
          >
            {t('liveChatSave')}
          </button>
          {rules.bans && rules.bans.length > 0 && (
            <div className="live-chat-bans">
              <p className="live-chat-panel-title">{t('liveChatBansHeading')}</p>
              {rules.bans.map((b) => (
                <div key={b.userId} className="live-chat-ban">
                  <span>
                    {b.username ?? '—'}{' '}
                    <span className="live-chat-panel-note">
                      {b.until
                        ? t('liveChatBannedUntil').replace('{time}', new Date(b.until).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }))
                        : t('liveChatBannedForever')}
                    </span>
                  </span>
                  <button type="button" className="live-small-btn" onClick={() => moderate(b.userId, 'unban')}>
                    {t('liveChatUnban')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div ref={listRef} className="live-chat-list" onScroll={onScroll} aria-live="polite">
        {unavailable && <p className="live-chat-empty">{t('liveChatUnavailable')}</p>}
        {!unavailable && messages.length === 0 && <p className="live-chat-empty">{t('liveChatEmpty')}</p>}
        {messages.map((m) => {
          const own = m.user_id === userId;
          const tip = tipLabel(m, lang);
          return (
            <div key={m.id} className={`live-chat-msg ${tip ? 'tip' : ''}`}>
              <span className="live-chat-avatar" aria-hidden="true">
                {m.profiles?.avatar_url ? <img src={m.profiles.avatar_url} alt="" loading="lazy" decoding="async" /> : null}
              </span>
              <span className="live-chat-text">
                <span className="live-chat-user">{m.profiles?.username ?? '—'}</span>
                {tip && <span className="live-chat-tip-amount">💛 {tip}</span>}
                {tip && m.body === '💛' ? null : m.body}
                {actionsFor === m.id && mod && !own && (
                  <span className="live-chat-actions">
                    <button type="button" onClick={() => remove(m.id)}>
                      {t('liveChatDelete')}
                    </button>
                    <button type="button" onClick={() => moderate(m.user_id, 'timeout', 10)}>
                      {t('liveChatTimeout')}
                    </button>
                    <button type="button" className="danger" onClick={() => moderate(m.user_id, 'ban')}>
                      {t('liveChatBan')}
                    </button>
                  </span>
                )}
              </span>
              {mod && !own ? (
                <button
                  type="button"
                  className="live-chat-delete"
                  onClick={() => setActionsFor((v) => (v === m.id ? null : m.id))}
                  aria-label={t('liveChatModerate')}
                  title={t('liveChatModerate')}
                >
                  ⋯
                </button>
              ) : own ? (
                <button type="button" className="live-chat-delete" onClick={() => remove(m.id)} aria-label={t('liveChatDelete')} title={t('liveChatDelete')}>
                  ✕
                </button>
              ) : null}
            </div>
          );
        })}
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
