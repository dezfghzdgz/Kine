'use client';

import { Suspense, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useWatchProgress } from '@/lib/useWatchProgress';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import VerifiedBadge from '@/components/VerifiedBadge';
import PostCard from '@/components/PostCard';
import { buildVideoBlocks } from '@/lib/videoBlocks';

function SubscriptionsPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [channels, setChannels] = useState<any[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
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
      .select('channel_id, profiles!subscriptions_channel_id_fkey(id, username, display_name, avatar_url, verification_tier, is_shadow_banned)')
      .eq('subscriber_id', authData.user.id);

    const channelList = (subs ?? []).map((s: any) => s.profiles).filter(Boolean);
    setChannels(channelList);

    // Shadow-bannovaný tvůrce zůstává v seznamu odběrů (výše), ale jeho
    // videa/posty se v samotném feedu nezobrazí.
    const channelIds = channelList.filter((c: any) => !c.is_shadow_banned).map((c: any) => c.id);
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

      const { data: postData } = await supabase
        .from('posts')
        .select('*, profiles!posts_owner_id_fkey(id, username, display_name, avatar_url, verification_tier)')
        .in('owner_id', channelIds)
        .order('created_at', { ascending: false })
        .limit(48);
      setPosts(postData ?? []);
    }

    setLoading(false);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>{t('loginToViewSubscriptionsNote')}</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="auth-gate">
        <p>{t('subscriptions')}</p>
        <p style={{ fontSize: 13 }}>{t('noSubscriptionsYet')}</p>
      </div>
    );
  }

  const filteredVideos = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;

  const feedItems = query
    ? filteredVideos.map((v) => ({ kind: 'video' as const, item: v, created_at: v.created_at }))
    : [
        ...filteredVideos.map((v) => ({ kind: 'video' as const, item: v, created_at: v.created_at })),
        ...posts.map((p) => ({ kind: 'post' as const, item: p, created_at: p.created_at })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

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

      <p className="panel-heading">{t('subscriptionsFeedHeading')}</p>
      {feedItems.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('noVideosToShowSubs')}</p>
      ) : (
        (() => {
          // Seskupí po sobě jdoucí videa do bloků (kvůli grid layoutu), posty vykreslí samostatně
          const groups: { kind: 'videos' | 'post'; videos?: any[]; post?: any }[] = [];
          feedItems.forEach((entry) => {
            if (entry.kind === 'video') {
              const last = groups[groups.length - 1];
              if (last && last.kind === 'videos') last.videos!.push(entry.item);
              else groups.push({ kind: 'videos', videos: [entry.item] });
            } else {
              groups.push({ kind: 'post', post: entry.item });
            }
          });

          return groups.map((group, gi) => {
            if (group.kind === 'post') {
              const post = group.post;
              const author = post.profiles;
              return (
                <div key={`post-${post.id}`} style={{ marginBottom: 20 }}>
                  {author && (
                    <Link href={`/channel/${author.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span className="profile-avatar-small" style={{ width: 24, height: 24, overflow: 'hidden' }}>
                        {author.avatar_url ? <img src={author.avatar_url} alt={author.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {author.display_name ?? author.username}
                        <VerifiedBadge tier={author.verification_tier} />
                      </span>
                    </Link>
                  )}
                  <PostCard post={post} userId={userId} />
                </div>
              );
            }

            return (
              <div key={`videos-${gi}`}>
                {buildVideoBlocks(group.videos!).map((block, bi) => (
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
                ))}
              </div>
            );
          });
        })()
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
