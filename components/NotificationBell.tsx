'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { DownloadIcon, PeopleIcon, PlaylistIcon, WatchLaterIcon, BellIcon, ThumbsUpIcon } from './ReactionIcons';
import UiIcon, { type UiIconName } from './UiIcon';
import { NOTIFICATIONS_REFRESH_EVENT } from './BadgeWatcher';
import { badgeNotificationText } from '@/lib/badgeText';
import { safeInternalLink } from '@/lib/safeLink';

type Notification = {
  id: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
  type: 'default' | 'collab_invite' | 'like_milestone' | 'view_milestone' | 'donation' | 'subscription' | 'new_video' | 'new_post' | 'comment_reply' | 'moderation_warning' | 'live' | 'badge';
  /** Kdo oznámení poslal z prohlížeče (odběr, komentář, pozvánka). Oznámení od Kine (serveru) ho nemají. */
  sender_id?: string | null;
  senderName?: string | null;
};

/**
 * Jeden zdroj oznámení pro všechny zvonečky naráz (postranní panel, spodní
 * lišta na telefonu, menu) - dřív se každý ptal databáze sám, každých 30 s
 * i ve skryté kartě. Teď jeden dotaz za 30 s, jen když je karta vidět
 * (a hned po návratu do ní); změny (přečteno, smazáno) vidí všechny zvonečky.
 */
type NotificationSnapshot = { userId: string | null; list: Notification[] };
let notificationSnapshot: NotificationSnapshot = { userId: null, list: [] };
const notificationListeners = new Set<(s: NotificationSnapshot) => void>();
let notificationsInflight: Promise<void> | null = null;
let notificationPoll: ReturnType<typeof setInterval> | null = null;
const NOTIFICATION_POLL_MS = 30000;

function emitNotifications(next: NotificationSnapshot) {
  notificationSnapshot = next;
  for (const fn of notificationListeners) fn(next);
}

function fetchNotifications(): Promise<void> {
  if (notificationsInflight) return notificationsInflight;
  notificationsInflight = (async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      emitNotifications({ userId: null, list: [] });
      return;
    }
    const me = authData.user.id;
    // select('*'): sloupec sender_id přidává migrace bezpecnost-rijen - bez ní by výčet sloupců spadl.
    const { data } = await supabase.from('notifications').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(30);
    // U oznámení od lidí (ne od Kine) je vidět, kdo je poslal - podvrh za
    // "systémovou" zprávu se tak pozná na první pohled.
    const rows = (data ?? []) as Notification[];
    const senderIds = Array.from(new Set(rows.map((r) => r.sender_id).filter((id): id is string => !!id && id !== me)));
    let names: Record<string, string> = {};
    if (senderIds.length > 0) {
      const { data: senders } = await supabase.from('profiles').select('id, username').in('id', senderIds);
      names = Object.fromEntries((senders ?? []).map((p: { id: string; username: string }) => [p.id, p.username]));
    }
    emitNotifications({ userId: me, list: rows.map((r) => ({ ...r, senderName: r.sender_id ? names[r.sender_id] ?? null : null })) });
  })()
    .catch(() => {
      // Výpadek sítě - zvonečky si nechají poslední stav, zkusí se to příště.
    })
    .finally(() => {
      notificationsInflight = null;
    });
  return notificationsInflight;
}

function onNotificationsVisible() {
  if (!document.hidden) void fetchNotifications();
}
function onNotificationsRefresh() {
  void fetchNotifications();
}

function subscribeNotifications(fn: (s: NotificationSnapshot) => void): () => void {
  notificationListeners.add(fn);
  fn(notificationSnapshot);
  if (notificationListeners.size === 1) {
    void fetchNotifications();
    notificationPoll = setInterval(() => {
      if (!document.hidden) void fetchNotifications();
    }, NOTIFICATION_POLL_MS);
    document.addEventListener('visibilitychange', onNotificationsVisible);
    // Nový odznak (components/BadgeWatcher.tsx) - oznámení hned, ne až za 30 s.
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onNotificationsRefresh);
  }
  return () => {
    notificationListeners.delete(fn);
    if (notificationListeners.size === 0) {
      if (notificationPoll) clearInterval(notificationPoll);
      notificationPoll = null;
      document.removeEventListener('visibilitychange', onNotificationsVisible);
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onNotificationsRefresh);
    }
  };
}

/** Změna seznamu (přečteno, smazáno) pro všechny zvonečky naráz. */
function patchNotifications(update: Notification[] | ((prev: Notification[]) => Notification[])) {
  const list = typeof update === 'function' ? update(notificationSnapshot.list) : update;
  emitNotifications({ ...notificationSnapshot, list });
}

/**
 * Každý druh oznámení má vlastní barvu, ikonku a název druhu.
 *
 * Dřív měla polovina typů stejnou šedou a lajky splývaly s dary, takže se
 * v seznamu nedalo nic najít očima. Barvy jsou schválně vybrané tak, aby
 * šly rozeznat i s barvoslepostí - nespoléhá se jen na barvu, u každého
 * řádku je i ikonka a popisek druhu.
 */
const NOTIFICATION_TYPE_STYLES: Record<string, { color: string; icon: UiIconName | 'thumbUp'; labelKey: string }> = {
  like_milestone: { color: '#4fbf87', icon: 'thumbUp', labelKey: 'notifTypeLike' },
  view_milestone: { color: '#4d9fff', icon: 'eye', labelKey: 'notifTypeViews' },
  subscription: { color: '#b07cf5', icon: 'users', labelKey: 'notifTypeSubscriber' },
  collab_invite: { color: '#f5a623', icon: 'link', labelKey: 'notifTypeCollab' },
  comment_reply: { color: '#45c9c9', icon: 'chat', labelKey: 'notifTypeComment' },
  donation: { color: '#f07eb0', icon: 'coins', labelKey: 'notifTypeDonation' },
  new_video: { color: '#8a8a8f', icon: 'film', labelKey: 'notifTypeNewVideo' },
  new_post: { color: '#5eb8ff', icon: 'pencil', labelKey: 'notifTypeNewPost' },
  moderation_warning: { color: '#e0453f', icon: 'warning', labelKey: 'notifTypeWarning' },
  live: { color: '#ff3b3b', icon: 'broadcast', labelKey: 'notifTypeLive' },
  badge: { color: '#e3b341', icon: 'trophy', labelKey: 'notifTypeBadge' },
  default: { color: '#8a8a8f', icon: 'bell', labelKey: 'notifTypeOther' },
};

/** Ikona druhu oznámení - čisté ikony jako všude jinde, ne emoji. */
function TypeIcon({ icon }: { icon: UiIconName | 'thumbUp' }) {
  return icon === 'thumbUp' ? <ThumbsUpIcon size={15} /> : <UiIcon name={icon} size={15} />;
}

function styleForType(type: string) {
  return NOTIFICATION_TYPE_STYLES[type] ?? NOTIFICATION_TYPE_STYLES.default;
}

const NAV_SHORTCUT_OPTIONS = [
  { key: 'notifications', href: null, labelKey: 'notifications' },
  { key: 'downloaded', href: '/downloaded', labelKey: 'downloaded' },
  { key: 'subscriptions', href: '/subscriptions', labelKey: 'subscriptions' },
  { key: 'playlists', href: '/playlists', labelKey: 'playlists' },
  { key: 'watchlater', href: '/watch-later', labelKey: 'watchLater' },
];

export default function NotificationBell({ mobileTrigger = false, onNavigate }: { mobileTrigger?: boolean; onNavigate?: () => void }) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<NotificationSnapshot>(notificationSnapshot);
  const notifications = snapshot.list;
  const userId = snapshot.userId;
  const setNotifications = patchNotifications;
  const [open, setOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [chosenIcon, setChosenIcon] = useState('notifications');
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Chyba se drží pro každou pozvánku zvlášť (klíč = id oznámení), jinak by
  // se hláška z jedné pozvánky ukazovala pod všemi ostatními.
  const [collabErrors, setCollabErrors] = useState<Record<string, string>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  // Společný zdroj pro všechny zvonečky (viz subscribeNotifications výš).
  useEffect(() => subscribeNotifications(setSnapshot), []);

  useEffect(() => {
    const saved = localStorage.getItem('kine-notification-icon');
    if (saved) setChosenIcon(saved);
  }, []);

  function handleBellClick() {
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 1500);

    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0;
      setOpen(false);
      setIconPickerOpen(true);
      return;
    }

    const option = NAV_SHORTCUT_OPTIONS.find((o) => o.key === chosenIcon);
    if (option?.href) {
      onNavigate?.();
      router.push(option.href);
      return;
    }
    setOpen((v) => !v);
  }

  function chooseIcon(icon: string) {
    setChosenIcon(icon);
    localStorage.setItem('kine-notification-icon', icon);
    setIconPickerOpen(false);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setIconPickerOpen(false);
        setCollabErrors({});
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleClick(n: Notification) {
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    setOpen(false);
    // Jen stránka Kine - starší záznam s odkazem ven ("//nekde.jinde") se neotevře.
    const link = safeInternalLink(n.link);
    if (link) {
      onNavigate?.();
      router.push(link);
    }
  }

  async function deleteNotification(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  // "Smazat vše" je nahoře hned po ruce - proto na dvě kliknutí (první se zeptá), ať se to nestane omylem.
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmClear]);
  useEffect(() => {
    if (!open) setConfirmClear(false);
  }, [open]);

  async function clearAll() {
    if (!userId) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    await supabase.from('notifications').delete().eq('user_id', userId);
    setNotifications([]);
  }

  async function markAllRead() {
    if (!userId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
  }

  async function respondToCollabInvite(n: Notification, accept: boolean) {
    const videoIdMatch = n.link?.match(/\/watch\/([a-f0-9-]+)/i);
    const videoId = videoIdMatch?.[1];

    if (videoId) {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch('/api/videos/respond-collab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
        body: JSON.stringify({ videoId, accept }),
      });

      // Když se odpověď neuloží, pozvánka musí zůstat viset - dřív zmizela
      // tak jako tak a spolupráce tiše propadla.
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCollabErrors((prev) => ({
          ...prev,
          [n.id]: body.error ?? t('collabResponseFailed'),
        }));
        return;
      }
    }

    setCollabErrors((prev) => {
      const next = { ...prev };
      delete next[n.id];
      return next;
    });
    await supabase.from('notifications').delete().eq('id', n.id);
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
  }

  if (!userId) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        className={mobileTrigger ? 'mobile-nav-item' : 'sidebar-link'}
        onClick={handleBellClick}
        style={{ position: 'relative' }}
      >
        <NotificationIcon icon={chosenIcon} />
        {!mobileTrigger && t((NAV_SHORTCUT_OPTIONS.find((o) => o.key === chosenIcon)?.labelKey ?? 'notifications') as any)}
        {mobileTrigger && <span style={{ fontSize: 9 }}>{t((NAV_SHORTCUT_OPTIONS.find((o) => o.key === chosenIcon)?.labelKey ?? 'notifications') as any)}</span>}
        {chosenIcon === 'notifications' && unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
      </button>

      {iconPickerOpen && (
        // Výběr ikonky vyjede přímo nad tlačítkem, kterého se týká - stejně
        // jako ostatní nabídky v menu. Dřív skákal doprostřed obrazovky.
        <div
          className="profile-dropdown"
          style={{ width: 240, maxHeight: '70vh', overflowY: 'auto' }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 0 10px' }}>{t('chooseNotificationIconNote')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {NAV_SHORTCUT_OPTIONS.map((option) => (
              <button
                key={option.key}
                onClick={() => chooseIcon(option.key)}
                className="profile-dropdown-item"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  fontWeight: chosenIcon === option.key ? 700 : 400,
                }}
              >
                <span style={{ display: 'flex', flexShrink: 0 }}>
                  <NotificationIcon icon={option.key} />
                </span>
                <span style={{ flex: 1, textAlign: 'left' }}>{t(option.labelKey as any)}</span>
                {chosenIcon === option.key && <span>✓</span>}
              </button>
            ))}
          </div>
          <button
            onClick={() => setIconPickerOpen(false)}
            className="profile-dropdown-item"
            style={{ textAlign: 'center', color: 'var(--text-faint)', marginTop: 6 }}
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {open && (
        <div className="profile-dropdown notification-list-dropdown" style={{ width: 300, maxHeight: 360, overflowY: 'auto' }}>
          {/* Hlavička nahoře (i při dlouhém seznamu): přečíst vše, smazat vše - dřív bylo mazání až úplně dole pod oznámeními. */}
          {notifications.length > 0 && (
            <div className="notification-list-head">
              <span className="notification-list-title">{t('notifications')}</span>
              {notifications.some((n) => !n.read) && (
                <button type="button" className="notification-head-btn" onClick={markAllRead}>
                  {t('markAllNotificationsRead')}
                </button>
              )}
              <button type="button" className={`notification-head-btn ${confirmClear ? 'danger' : ''}`} onClick={clearAll} title={t('clearAllNotifications')}>
                {confirmClear ? t('clearAllNotificationsConfirm') : t('clearAllShort')}
              </button>
            </div>
          )}
          {notifications.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', padding: 10 }}>{t('noNotificationsYet')}</p>
          ) : (
            <>
              {notifications.map((n) => (
                n.type === 'collab_invite' ? (
                  <div
                    key={n.id}
                    style={{
                      padding: 10, borderRadius: 8, margin: '4px 6px',
                      background: 'rgba(0, 201, 167, 0.12)', border: '1px solid var(--brand)',
                    }}
                  >
                    <p style={{ fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>
                      {n.message}
                      {n.senderName && (
                        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 400, color: 'var(--text-dim)', marginTop: 2 }}>@{n.senderName}</span>
                      )}
                    </p>
                    {collabErrors[n.id] && (
                      <p style={{ fontSize: 11.5, color: '#ff6b6b', margin: '0 0 8px' }}>{collabErrors[n.id]}</p>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => respondToCollabInvite(n, true)}
                        style={{ flex: 1, fontSize: 12, padding: '6px 0' }}
                      >
                        {t('acceptInviteButton')}
                      </button>
                      <button
                        onClick={() => respondToCollabInvite(n, false)}
                        style={{ flex: 1, fontSize: 12, padding: '6px 0', background: 'var(--panel-raised)', color: 'var(--text)' }}
                      >
                        {t('declineInviteButton')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={n.id}
                    className="notification-row"
                    style={{ borderLeftColor: styleForType(n.type).color }}
                  >
                    <span
                      className="notification-type-icon"
                      style={{ background: `${styleForType(n.type).color}22`, color: styleForType(n.type).color }}
                      aria-hidden="true"
                    >
                      <TypeIcon icon={styleForType(n.type).icon} />
                    </span>

                    <button
                      onClick={() => handleClick(n)}
                      className="profile-dropdown-item"
                      style={{
                        display: 'block', fontWeight: n.read ? 400 : 600, flex: 1,
                        color: n.type === 'moderation_warning' ? '#e0453f' : undefined,
                      }}
                    >
                      <span
                        className="notification-type-label"
                        style={{ color: styleForType(n.type).color }}
                      >
                        {t(styleForType(n.type).labelKey as any)}
                      </span>
                      {(n.type === 'badge' && badgeNotificationText(n.message, t, lang)) || n.message}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                        {new Date(n.created_at).toLocaleString(DATE_LOCALES[lang])}
                        {n.senderName && n.type !== 'like_milestone' ? ` · @${n.senderName}` : ''}
                      </span>
                    </button>
                    <button
                      onClick={(e) => deleteNotification(e, n.id)}
                      style={{ background: 'none', color: 'var(--text-faint)', padding: 6, fontSize: 12, display: 'inline-flex' }}
                      aria-label={t('delete')}
                      title={t('delete')}
                    >
                      <UiIcon name="close" size={14} />
                    </button>
                  </div>
                )
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'downloaded':
      return <DownloadIcon size={18} />;
    case 'subscriptions':
      return <PeopleIcon size={18} />;
    case 'playlists':
      return <PlaylistIcon size={18} />;
    case 'watchlater':
      return <WatchLaterIcon size={18} />;
    default:
      return <BellIcon size={18} />;
  }
}
