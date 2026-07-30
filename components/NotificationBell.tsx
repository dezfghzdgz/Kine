'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { DownloadIcon, PeopleIcon, PlaylistIcon, WatchLaterIcon, BellIcon } from './ReactionIcons';

type Notification = {
  id: string;
  message: string;
  link: string | null;
  read: boolean;
  created_at: string;
  type: 'default' | 'collab_invite' | 'like_milestone' | 'donation' | 'subscription' | 'new_video' | 'comment_reply';
};

const NOTIFICATION_TYPE_STYLES: Record<string, { color: string }> = {
  like_milestone: { color: '#f5a623' },
  donation: { color: '#f5a623' },
  subscription: { color: '#4d9fff' },
  new_video: { color: 'var(--text-faint)' },
  comment_reply: { color: 'var(--text-faint)' },
  default: { color: 'var(--text-faint)' },
};

const NAV_SHORTCUT_OPTIONS = [
  { key: 'notifications', href: null, labelKey: 'notifications' },
  { key: 'downloaded', href: '/downloaded', labelKey: 'downloaded' },
  { key: 'subscriptions', href: '/subscriptions', labelKey: 'subscriptions' },
  { key: 'playlists', href: '/playlists', labelKey: 'playlists' },
  { key: 'watchlater', href: '/watch-later', labelKey: 'watchLater' },
];

export default function NotificationBell({ mobileTrigger = false }: { mobileTrigger?: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [chosenIcon, setChosenIcon] = useState('notifications');
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // obnovit každých 30s
    return () => clearInterval(interval);
  }, []);

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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;
    setUserId(authData.user.id);

    const { data } = await supabase
      .from('notifications')
      .select('id, message, link, read, created_at, type')
      .eq('user_id', authData.user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    setNotifications(data ?? []);
  }

  async function handleClick(n: Notification) {
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id);
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function deleteNotification(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await supabase.from('notifications').delete().eq('id', id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  async function clearAll() {
    if (!userId) return;
    await supabase.from('notifications').delete().eq('user_id', userId);
    setNotifications([]);
  }

  async function respondToCollabInvite(n: Notification, accept: boolean) {
    const videoIdMatch = n.link?.match(/\/watch\/([a-f0-9-]+)/i);
    const videoId = videoIdMatch?.[1];
    if (videoId) {
      const { data: sessionData } = await supabase.auth.getSession();
      await fetch('/api/videos/respond-collab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
        body: JSON.stringify({ videoId, accept }),
      });
    }
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
        {!mobileTrigger && t('notifications')}
        {mobileTrigger && <span style={{ fontSize: 9 }}>{t('notifications')}</span>}
        {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
      </button>

      {iconPickerOpen && (
        <div className="profile-dropdown" style={{ width: 240 }}>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 8px 10px' }}>{t('chooseNotificationIconNote')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px 8px' }}>
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
                <NotificationIcon icon={option.key} />
                <span style={{ flex: 1, textAlign: 'left' }}>{t(option.labelKey as any)}</span>
                {chosenIcon === option.key && <span>✓</span>}
              </button>
            ))}
          </div>
          <button
            onClick={() => setIconPickerOpen(false)}
            className="profile-dropdown-item"
            style={{ textAlign: 'center', color: 'var(--text-faint)' }}
          >
            {t('cancel')}
          </button>
        </div>
      )}

      {open && (
        <div className="profile-dropdown" style={{ width: 300, maxHeight: 360, overflowY: 'auto' }}>
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
                    <p style={{ fontSize: 13, margin: '0 0 8px', fontWeight: 600 }}>{n.message}</p>
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
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      borderLeft: `3px solid ${(NOTIFICATION_TYPE_STYLES[n.type] ?? NOTIFICATION_TYPE_STYLES.default).color}`,
                    }}
                  >
                    <button
                      onClick={() => handleClick(n)}
                      className="profile-dropdown-item"
                      style={{ display: 'block', fontWeight: n.read ? 400 : 600, flex: 1 }}
                    >
                      {n.message}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                        {new Date(n.created_at).toLocaleString('cs-CZ')}
                      </span>
                    </button>
                    <button
                      onClick={(e) => deleteNotification(e, n.id)}
                      style={{ background: 'none', color: 'var(--text-faint)', padding: 6, fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </div>
                )
              ))}
              <button
                onClick={clearAll}
                style={{ background: 'none', color: 'var(--text-faint)', fontSize: 12, width: '100%', marginTop: 6, textDecoration: 'underline' }}
              >
                {t('clearAllNotifications')}
              </button>
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
