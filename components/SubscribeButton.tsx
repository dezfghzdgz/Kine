'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function SubscribeButton({ channelId }: { channelId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
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
      .select('subscriber_id')
      .eq('channel_id', channelId);

    setCount(subs?.length ?? 0);
    setSubscribed(!!subs?.some((s) => s.subscriber_id === authData.user?.id));
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

  if (userId === channelId) return null; // vlastník kanálu nevidí tlačítko u sebe

  return (
    <button
      onClick={toggle}
      disabled={loading}
      style={{
        background: subscribed ? 'var(--panel-raised)' : 'var(--text)',
        color: subscribed ? 'var(--text)' : '#0a0a0b',
        border: subscribed ? '1px solid var(--border)' : 'none',
        marginTop: 10,
      }}
    >
      {subscribed ? `${t('subscribing')} (${count})` : `${t('subscribe')} (${count})`}
    </button>
  );
}
