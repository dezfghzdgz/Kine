'use client';

import { Suspense, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import VerifiedBadge from '@/components/VerifiedBadge';
import { buildVideoBlocks } from '@/lib/videoBlocks';

function SubscriptionsPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [channels, setChannels] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const watchProgress = useWatchProgress(videos.map((v: any) => v.id));
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLoading(false);
      return;
    }
    setUserId(authData.user.id);

    const { data: subs } = await supabase
      .from('subscriptions')
      .select('channel_id, profiles!subscriptions_channel_id_fkey(id, username, display_name, avatar_url, verification_tier)')
      .eq('subscriber_id', authData.user.id);

    const channelList = (subs ?? []).map((s: any) => s.profiles).filter(Boolean);
    setChannels(channelList);

    const channelIds = channelList.map((c: any) => c.id);
    if (channelIds.length > 0) {
      const { data: videoData } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, created_at, profiles!videos_owner_id_fkey(username)')
        .in('owner_id', channelIds)
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .order('created_at', { ascending: false })
        .limit(48);
      setVideos(videoData ?? []);
    }

    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>Pro odebírání kanálů se musíš nejdřív přihlásit.</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="auth-gate">
        <p>Odběry</p>
        <p style={{ fontSize: 13 }}>{t('noSubscriptionsYet')}</p>
      </div>
    );
  }

  const filteredVideos = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;

  return (
    <div>
      <p className="section-title">{t('subscriptionsTitle')}</p>

      <div style={{ display: 'flex', gap: 20, overflowX: 'auto', paddingBottom: 20, marginBottom: 28 }}>
        {channels.map((c: any) => (
          <Link
            key={c.id}
            href={`/channel/${c.id}`}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0, width: 84 }}
          >
            <span className="creator-avatar" style={{ width: 64, height: 64, overflow: 'hidden' }}>
              {c.avatar_url ? <img src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
            </span>
            <span style={{ fontSize: 12, textAlign: 'center', color: 'var(--text-dim)', lineHeight: 1.3 }}>
              {c.display_name ?? c.username}
              <VerifiedBadge tier={c.verification_tier} />
            </span>
          </Link>
        ))}
      </div>

      <p className="panel-heading">Nejnovější od tvůrců, které odebíráš</p>
      {filteredVideos.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('noVideosToShowSubs')}</p>
      ) : (
        buildVideoBlocks(filteredVideos).map((block, bi) => (
          <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
            {block.items.map((v: any) => (
              <Link
                href={block.type === 'sparks' ? `/sparks?start=${v.id}` : `/watch/${v.id}`}
                key={v.id}
                className="video-card"
              >
                <div className={block.type === 'sparks' ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
                  {v.thumbnail_url ? (
                    <Image src={v.thumbnail_url} alt={v.title} width={320} height={180} />
                  ) : null}
                  <div className="play-badge">▶</div>
                </div>
                <p className="video-card-title">{v.title}</p>
                <p className="video-card-meta">
                  {v.profiles?.username ?? 'neznámý tvůrce'} · {v.views} {t('views')}
                </p>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionsPageInner />
    </Suspense>
  );
}
