'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function CreatorSubscribeButton({ creatorId }: { creatorId: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [userId, setUserId] = useState<string | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    load();
  }, [creatorId]);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);

    const { data: creatorProfile } = await supabase
      .from('profiles')
      .select('subscription_price_eur, stripe_onboarding_complete')
      .eq('id', creatorId)
      .single();

    if (creatorProfile?.stripe_onboarding_complete && creatorProfile.subscription_price_eur) {
      setPrice(creatorProfile.subscription_price_eur);
    }

    if (authData.user) {
      const { data: existing } = await supabase
        .from('channel_subscriptions')
        .select('status')
        .eq('subscriber_id', authData.user.id)
        .eq('creator_id', creatorId)
        .eq('status', 'active')
        .maybeSingle();
      setSubscribed(!!existing);
    }
  }

  async function handleSubscribe() {
    if (!userId) {
      router.push('/login');
      return;
    }
    setLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/creator/subscribe-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ creatorId }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.url) window.location.href = data.url;
  }

  if (!price || userId === creatorId) return null;

  if (subscribed) {
    return (
      <button disabled style={{ background: 'var(--panel-raised)', color: '#4dbb7a', border: '1px solid var(--border)' }}>
        ✓ {t('channelMemberLabel')}
      </button>
    );
  }

  return (
    <button onClick={handleSubscribe} disabled={loading} style={{ background: '#f5a623', color: '#0a0a0b' }}>
      {loading ? t('processing') : `${t('joinChannelButton')} · ${price} €/${t('perMonth')}`}
    </button>
  );
}
