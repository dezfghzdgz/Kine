'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import SubscribeButton from '@/components/SubscribeButton';
import VerifiedBadge from '@/components/VerifiedBadge';
import PostComposer from '@/components/PostComposer';
import PostCard from '@/components/PostCard';
import { buildVideoBlocks } from '@/lib/videoBlocks';
import { useLanguage } from '@/lib/i18n';
import { computeTrustRatingClient, getTotalReactionCount, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';

type Tab = 'home' | 'videos' | 'sparks' | 'posts' | 'playlists';

function ChannelPageInner() {
  const { t } = useLanguage();
  const params = useParams();
  const channelId = params.id as string;
  const [profile, setProfile] = useState<any>(null);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [trustRating, setTrustRating] = useState<number | null>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [isNewCreator, setIsNewCreator] = useState(false);
  const [channelPlaylists, setChannelPlaylists] = useState<any[]>([]);
  const [savedPlaylistIds, setSavedPlaylistIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const searchParams = useSearchParams();

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'posts' || tabParam === 'videos' || tabParam === 'sparks' || tabParam === 'playlists') {
      setTab(tabParam as Tab);
    }
  }, [searchParams]);

  useEffect(() => {
    load();
  }, [channelId]);

  async function load() {
    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);

    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, banner_url, bio, social_links, verification_tier, created_at, trailer_video_id, trailer:videos!profiles_trailer_video_id_fkey(id, title, cloudflare_video_id, thumbnail_url)')
      .eq('id', channelId)
      .single();
    setProfile(profileData);
    if (profileData) {
      computeTrustRatingClient(profileData.id, profileData.created_at).then(async (score) => {
        const reactionCount = await getTotalReactionCount(profileData.id);
        if (reactionCount >= RATING_UNLOCK_THRESHOLD) setTrustRating(score);
      });
    }

    const { count } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', channelId);
    setSubscriberCount(count ?? 0);

    if (profileData) {
      const { data: videoData } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, width, height, duration_seconds, created_at')
        .eq('owner_id', channelId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false });
      setVideos(videoData ?? []);

      const { data: postData } = await supabase
        .from('posts')
        .select('*')
        .eq('owner_id', channelId)
        .order('created_at', { ascending: false });
      setPosts(postData ?? []);

      const allContentDates = [
        ...(videoData ?? []).map((v: any) => v.created_at),
        ...(postData ?? []).map((p: any) => p.created_at),
      ];
      if (allContentDates.length > 0) {
        const earliest = new Date(Math.min(...allContentDates.map((d) => new Date(d).getTime())));
        const daysSinceFirst = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24);
        setIsNewCreator(daysSinceFirst <= 30);
      }

      const { data: playlistData } = await supabase
        .from('playlists')
        .select('id, title, color, thumbnail_url, playlist_videos(video_id)')
        .eq('owner_id', channelId)
        .eq('visibility', 'public')
        .eq('is_system', false)
        .order('created_at', { ascending: false });
      setChannelPlaylists(playlistData ?? []);

      if (authData.user) {
        const { data: myPlaylists } = await supabase
          .from('playlists')
          .select('saved_from')
          .eq('owner_id', authData.user.id)
          .not('saved_from', 'is', null);
        setSavedPlaylistIds(new Set((myPlaylists ?? []).map((p: any) => p.saved_from)));
      }
    }
    setLoading(false);
  }

  async function savePlaylist(playlist: any) {
    if (!userId) { return; }
    const { data: newPlaylist, error } = await supabase
      .from('playlists')
      .insert({ owner_id: userId, title: playlist.title, color: playlist.color, thumbnail_url: playlist.thumbnail_url, visibility: 'private', saved_from: playlist.id })
      .select()
      .single();
    if (error || !newPlaylist) return;

    const videoIds = (playlist.playlist_videos ?? []).map((pv: any) => pv.video_id);
    if (videoIds.length > 0) {
      await supabase.from('playlist_videos').insert(
        videoIds.map((videoId: string, i: number) => ({ playlist_id: newPlaylist.id, video_id: videoId, position: i }))
      );
    }
    setSavedPlaylistIds((prev) => new Set(prev).add(playlist.id));
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  if (!profile) return <p>Kanál nenalezen.</p>;

  const isOwner = userId === channelId;
  const longVideos = videos.filter((v) => !(v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120));
  const sparkVideos = videos.filter((v) => v.height && v.width && v.height > v.width && (v.duration_seconds ?? 0) <= 120);

  function renderVideoGrid(list: any[]) {
    if (list.length === 0) {
      return <p style={{ color: 'var(--text-faint)' }}>{t('nothingToShowYet')}</p>;
    }
    return (
      <div className="video-grid">
        {list.map((video: any) => (
          <Link href={`/watch/${video.id}`} key={video.id} className="video-card">
            <div className="video-thumb">
              {video.thumbnail_url ? (
                <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
              ) : null}
              <div className="play-badge">▶</div>
            </div>
            <p className="video-card-title">{video.title}</p>
            <p className="video-card-meta">{video.views} {t('views')}</p>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          width: '100%', height: 160, borderRadius: 12, overflow: 'hidden', marginBottom: -40,
          background: profile.banner_url ? undefined : 'var(--panel-raised)',
        }}
      >
        {profile.banner_url && (
          <img src={profile.banner_url} alt="banner" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, padding: '0 8px', marginBottom: 20 }}>
        <div
          className="creator-avatar"
          style={{ width: 96, height: 96, overflow: 'hidden', border: '4px solid var(--bg)', flexShrink: 0 }}
        >
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt={profile.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : null}
        </div>

        <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
          <p className="video-title" style={{ margin: 0, fontSize: 24 }}>
            {profile.display_name ?? profile.username}
            <VerifiedBadge tier={profile.verification_tier} />
            {trustRating !== null && trustRating >= 90 && (
              <span title={`Vysoký rating (${trustRating}%)`} style={{ marginLeft: 5, fontSize: 15 }}>⭐</span>
            )}
            {(trustRating === null || trustRating < 90) && isNewCreator && (
              <span
                title="Tenhle tvůrce je tu nový (prvních 30 dní)"
                style={{
                  marginLeft: 6, fontSize: 11, background: 'var(--panel-raised)', color: 'var(--text-faint)',
                  border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px', verticalAlign: 'middle',
                }}
              >
                🆕 Nováček
              </span>
            )}
          </p>
          <p className="video-meta" style={{ margin: '4px 0' }}>
            @{profile.username} · {subscriberCount} {t('subscribersSuffix')} · {videos.length} {t('videosSuffix')}
            {trustRating !== null && ` · Rating ${trustRating}%`}
          </p>
          {profile.bio && (
            <p style={{ color: 'var(--text-dim)', fontSize: 13, maxWidth: 560, margin: '4px 0' }}>{profile.bio}</p>
          )}
          {profile.social_links && profile.social_links.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {profile.social_links.map((link: { label: string; url: string }, i: number) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 12, background: 'var(--panel-raised)', border: '1px solid var(--border)',
                    padding: '5px 11px', borderRadius: 999,
                  }}
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div style={{ paddingBottom: 4 }}>
          <SubscribeButton channelId={profile.id} />
        </div>
      </div>

      {!isOwner && profile.trailer && (
        <div style={{ marginBottom: 24 }}>
          <p className="panel-heading">Upoutávka kanálu</p>
          <div className="player-wrap" style={{ aspectRatio: '16/9', maxWidth: 640 }}>
            <iframe
              src={`https://iframe.videodelivery.net/${profile.trailer.cloudflare_video_id}?autoplay=true&muted=true&loop=true&controls=true`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
              allowFullScreen
            />
          </div>
        </div>
      )}

      <div className="tab-row" style={{ marginBottom: 24 }}>
        <button className={`tab-btn ${tab === 'home' ? 'active' : ''}`} onClick={() => setTab('home')}>{t('channelHomeTab')}</button>
        <button className={`tab-btn ${tab === 'videos' ? 'active' : ''}`} onClick={() => setTab('videos')}>{t('videosTab')}</button>
        <button className={`tab-btn ${tab === 'sparks' ? 'active' : ''}`} onClick={() => setTab('sparks')}>Sparks</button>
        <button className={`tab-btn ${tab === 'posts' ? 'active' : ''}`} onClick={() => setTab('posts')}>{t('postsTab')}</button>
        <button className={`tab-btn ${tab === 'playlists' ? 'active' : ''}`} onClick={() => setTab('playlists')}>{t('playlistsTab')}</button>
      </div>

      {tab === 'home' && (
        <div>
          {buildVideoBlocks(videos).map((block, i) => (
            <div key={i} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
              {block.items.map((video: any) => (
                <Link
                  href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                  key={video.id}
                  className="video-card"
                >
                  <div className={block.type === 'sparks' ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
                    {video.thumbnail_url ? (
                      <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
                    ) : null}
                    <div className="play-badge">▶</div>
                  </div>
                  <p className="video-card-title">{video.title}</p>
                  <p className="video-card-meta">{video.views} {t('views')}</p>
                </Link>
              ))}
            </div>
          ))}
          {videos.length === 0 && <p style={{ color: 'var(--text-faint)' }}>{t('channelHasNoVideos')}</p>}
        </div>
      )}

      {tab === 'videos' && renderVideoGrid(longVideos)}
      {tab === 'sparks' && (
        <div className="shorts-grid">
          {sparkVideos.map((video: any) => (
            <Link href={`/sparks?start=${video.id}`} key={video.id} className="video-card">
              <div className="video-thumb video-thumb-vertical">
                {video.thumbnail_url ? (
                  <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
                ) : null}
                <div className="play-badge">▶</div>
              </div>
              <p className="video-card-title">{video.title}</p>
              <p className="video-card-meta">{video.views} {t('views')}</p>
            </Link>
          ))}
          {sparkVideos.length === 0 && <p style={{ color: 'var(--text-faint)' }}>{t('noSparksYet')}</p>}
        </div>
      )}

      {tab === 'posts' && (
        <div style={{ maxWidth: 560 }}>
          {isOwner && <PostComposer userId={userId!} onPosted={load} initialType={searchParams.get('compose') as 'text' | 'photo' | 'poll' | null} />}
          {posts.length === 0 ? (
            <p style={{ color: 'var(--text-faint)' }}>{t('noPostsYet')}</p>
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} userId={userId} />)
          )}
        </div>
      )}

      {tab === 'playlists' && (
        channelPlaylists.length === 0 ? (
          <p style={{ color: 'var(--text-faint)' }}>{t('creatorHasNoPublicPlaylists')}</p>
        ) : (
          <div className="video-grid">
            {channelPlaylists.map((p: any) => (
              <div key={p.id}>
                <Link href={`/playlists/${p.id}`} className="video-card">
                  <div
                    className="video-thumb"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: p.thumbnail_url ? undefined : (p.color ?? '#3a3a40'), overflow: 'hidden' }}
                  >
                    {p.thumbnail_url ? (
                      <img src={p.thumbnail_url} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600 }}>
                        {p.playlist_videos?.length ?? 0} videí
                      </span>
                    )}
                  </div>
                  <p className="video-card-title">{p.title}</p>
                </Link>
                {!isOwner && (
                  <button
                    onClick={() => savePlaylist(p)}
                    disabled={savedPlaylistIds.has(p.id)}
                    style={{ width: '100%', marginTop: 8, background: 'var(--panel-raised)', color: 'var(--text)', fontSize: 12 }}
                  >
                    {savedPlaylistIds.has(p.id) ? t('saved') : t('saveToMine')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

export default function ChannelPage() {
  return (
    <Suspense fallback={null}>
      <ChannelPageInner />
    </Suspense>
  );
}
