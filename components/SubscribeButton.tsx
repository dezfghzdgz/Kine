'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { BellIcon } from './ReactionIcons';

export default function SubscribeButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [notifyNewVideos, setNotifyNewVideos] = useState(true);
  const [bellMenuOpen, setBellMenuOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, [channelId]);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);

    const { data: subs } = await supabase
      .from('subscriptions')
      .select('subscriber_id, notify_new_videos')
      .eq('channel_id', channelId);

    setCount(subs?.length ?? 0);
    const mine = subs?.find((s) => s.subscriber_id === authData.user?.id);
    setSubscribed(!!mine);
    setNotifyNewVideos(mine?.notify_new_videos ?? true);
  }

  async function toggle() {
    if (!userId) {
      router.push('/login');
      return;
    }
    if (userId === channelId) return; // nemůžeš odebírat sám sebe

    setLoading(true);
    if (subscribed) {
      await supabase.from('subscriptions').delete().eq('subscriber_id', userId).eq('channel_id', channelId);
      setBellMenuOpen(false);
    } else {
      await supabase.from('subscriptions').insert({ subscriber_id: userId, channel_id: channelId });

      const { data: myProfile } = await supabase.from('profiles').select('username').eq('id', userId).single();
      await supabase.from('notifications').insert({
        user_id: channelId,
        message: `${myProfile?.username ?? 'Někdo'} začal odebírat tvůj kanál`,
        link: `/channel/${userId}`,
      });
    }
    await load();
    setLoading(false);
  }

  async function toggleNotify() {
    const next = !notifyNewVideos;
    setNotifyNewVideos(next);
    await supabase
      .from('subscriptions')
      .update({ notify_new_videos: next })
      .eq('subscriber_id', userId)
      .eq('channel_id', channelId);
  }

  if (userId === channelId) return null; // vlastník kanálu nevidí tlačítko u sebe

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={toggle}
        disabled={loading}
        style={{
          background: subscribed ? 'var(--panel-raised)' : 'var(--text)',
          color: subscribed ? 'var(--text)' : '#0a0a0b',
          border: subscribed ? '1px solid var(--border)' : 'none',
        }}
      >
        {subscribed ? `${t('subscribing')} (${count})` : `${t('subscribe')} (${count})`}
      </button>

      {subscribed && (
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setBellMenuOpen((v) => !v)}
            style={{
              background: 'var(--panel-raised)', color: 'var(--text)', border: '1px solid var(--border)',
              width: 40, height: 40, borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <BellIcon muted={!notifyNewVideos} size={17} />
          </button>
          {bellMenuOpen && (
            <div className="profile-dropdown" style={{ width: 220, top: 'calc(100% + 8px)', bottom: 'auto' }}>
              <button
                className="profile-dropdown-item"
                onClick={() => { toggleNotify(); if (!notifyNewVideos) setBellMenuOpen(false); }}
                style={{ fontWeight: notifyNewVideos ? 700 : 400, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <BellIcon size={15} />
                <span style={{ flex: 1, textAlign: 'left' }}>{t('notifyAllNewVideos')}</span>
                {notifyNewVideos && <span>✓</span>}
              </button>
              <button
                className="profile-dropdown-item"
                onClick={() => { if (notifyNewVideos) toggleNotify(); setBellMenuOpen(false); }}
                style={{ fontWeight: !notifyNewVideos ? 700 : 400, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <BellIcon muted size={15} />
                <span style={{ flex: 1, textAlign: 'left' }}>{t('notifyNone')}</span>
                {!notifyNewVideos && <span>✓</span>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
