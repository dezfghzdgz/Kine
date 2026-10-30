'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { dropdownSide, type DropdownSide } from '@/lib/dropdownSide';
import { BellIcon } from './ReactionIcons';

const BELL_MENU_WIDTH = 230;

export default function SubscribeButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [notifyNewVideos, setNotifyNewVideos] = useState(true);
  const [bellMenuOpen, setBellMenuOpen] = useState(false);
  // Nabídka zvonečku se otevře doleva, když by doprava vyjela z okna (velké okno, celá obrazovka).
  const [bellSide, setBellSide] = useState<DropdownSide>('left');
  const bellWrapRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, [channelId]);

  // Otevřená nabídka: strana podle místa v okně; zavře se kliknutím vedle nebo Esc.
  useEffect(() => {
    if (!bellMenuOpen) return;
    const place = () => setBellSide(dropdownSide(bellWrapRef.current, BELL_MENU_WIDTH));
    place();
    const onDown = (e: MouseEvent) => {
      if (bellWrapRef.current && !bellWrapRef.current.contains(e.target as Node)) setBellMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBellMenuOpen(false);
    };
    window.addEventListener('resize', place);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellMenuOpen]);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);

    // Počet přes count, ne přes délku seznamu: databáze vrací nejvíc 1000
    // řádků, takže kanál s 1200 odběrateli ukazoval "1000" - a k tomu se
    // do prohlížeče stahoval celý seznam odběratelů jen kvůli jednomu
    // řádku (tomu mému).
    const [{ count }, mineResult] = await Promise.all([
      supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('channel_id', channelId),
      authData.user
        ? supabase
            .from('subscriptions')
            .select('notify_new_videos')
            .eq('channel_id', channelId)
            .eq('subscriber_id', authData.user.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    setCount(count ?? 0);
    const mine = (mineResult as any)?.data;
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
        type: 'subscription',
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
        <div ref={bellWrapRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setBellMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={bellMenuOpen}
            aria-label={t('notifyAllNewVideos')}
            style={{
              background: 'var(--panel-raised)', color: 'var(--text)', border: '1px solid var(--border)',
              width: 40, height: 40, borderRadius: '50%', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <BellIcon muted={!notifyNewVideos} size={17} />
          </button>
          {bellMenuOpen && (
            <div
              className="profile-dropdown"
              role="menu"
              style={{
                width: BELL_MENU_WIDTH,
                maxWidth: 'calc(100vw - 16px)',
                top: 'calc(100% + 8px)',
                bottom: 'auto',
                ...(bellSide === 'right' ? { left: 'auto', right: 0 } : { left: 0, right: 'auto' }),
              }}
            >
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
