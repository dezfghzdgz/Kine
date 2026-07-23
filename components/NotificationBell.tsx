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
};

export default function NotificationBell({ mobileTrigger = false }: { mobileTrigger?: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // obnovit každých 30s
    return () => clearInterval(interval);
  }, []);

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
      .select('id, message, link, read, created_at')
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

  if (!userId) return null;

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        className={mobileTrigger ? 'mobile-nav-item' : 'sidebar-link'}
        onClick={() => setOpen((v) => !v)}
        style={{ position: 'relative' }}
      >
        <BellIcon />
        {!mobileTrigger && t('notifications')}
        {mobileTrigger && <span style={{ fontSize: 9 }}>{t('notifications')}</span>}
        {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="profile-dropdown" style={{ width: 300, maxHeight: 360, overflowY: 'auto' }}>
          {notifications.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', padding: 10 }}>{t('noNotificationsYet')}</p>
          ) : (
            <>
              {notifications.map((n) => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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

function BellIcon() {
  return (
    <svg className="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M6 9a6 6 0 0 1 12 0c0 3.5 1 5 2 6H4c1-1 2-2.5 2-6z" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}
