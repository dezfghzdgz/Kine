'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

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

export default function NotificationBell({ mobileTrigger = false }: { mobileTrigger?: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [chosenIcon, setChosenIcon] = useState('bell');
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
        <div className="profile-dropdown" style={{ width: 220 }}>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 8px 10px' }}>{t('chooseNotificationIconNote')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '0 8px 8px' }}>
            {NOTIFICATION_ICON_OPTIONS.map((icon) => (
              <button
                key={icon}
                onClick={() => chooseIcon(icon)}
                style={{
                  background: chosenIcon === icon ? 'var(--text)' : 'var(--panel-raised)',
                  color: chosenIcon === icon ? 'var(--bg)' : 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 8, padding: 8,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <NotificationIcon icon={icon} />
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

const NOTIFICATION_ICON_OPTIONS = ['bell', 'star', 'heart', 'flash', 'mail', 'megaphone', 'flag', 'circle'];

function NotificationIcon({ icon }: { icon: string }) {
  const common = { className: 'sidebar-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };

  switch (icon) {
    case 'star':
      return (
        <svg {...common}>
          <path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6z" strokeLinejoin="round" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...common}>
          <path d="M12 20s-7-4.4-9.3-8.7C1.2 8.3 3 5 6.2 5c2 0 3.3 1.1 4 2.2C10.9 6.1 12.2 5 14.2 5c3.2 0 5 3.3 3.5 6.3C19.4 15.6 12 20 12 20z" strokeLinejoin="round" />
        </svg>
      );
    case 'flash':
      return (
        <svg {...common}>
          <path d="M13 2 4 14h6l-1 8 9-12h-6z" strokeLinejoin="round" />
        </svg>
      );
    case 'mail':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M4 6l8 7 8-7" strokeLinejoin="round" />
        </svg>
      );
    case 'megaphone':
      return (
        <svg {...common}>
          <path d="M3 10v4h3l7 4V6l-7 4H3z" strokeLinejoin="round" />
          <path d="M17 9a4 4 0 0 1 0 6" strokeLinecap="round" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...common}>
          <path d="M5 3v18" strokeLinecap="round" />
          <path d="M5 4h13l-3 4 3 4H5" strokeLinejoin="round" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6z" strokeLinejoin="round" />
          <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
      );
  }
}
