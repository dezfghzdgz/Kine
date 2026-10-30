'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import SubscribeButton from '@/components/SubscribeButton';
import CreatorSubscribeButton from '@/components/CreatorSubscribeButton';
import VerifiedBadge from '@/components/VerifiedBadge';
import PlusBadge from '@/components/PlusBadge';
import PostComposer from '@/components/PostComposer';
import PostCard from '@/components/PostCard';
import { sortPosts } from '@/lib/posts';
import { buildVideoBlocks, isSpark } from '@/lib/videoBlocks';
import { safeExternalUrl } from '@/lib/safeUrl';
import { useLanguage } from '@/lib/i18n';
import { channelTrust, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';
import { useUserRole } from '@/lib/useUserRole';
import ConfirmDialog from '@/components/ConfirmDialog';
import LiveBadge from '@/components/LiveBadge';
import { visibleNowFilter } from '@/lib/scheduling';
import { setAmbientSource } from '@/lib/appearance';
import { VideoBlockRow } from '@/components/SparksShelf';
import ChannelBadges from '@/components/ChannelBadges';
import { BADGE_CHECK_EVENT } from '@/components/BadgeWatcher';
import UiIcon from '@/components/UiIcon';
import type { BadgeStats } from '@/lib/badges';
import ProfileImage from '@/components/ProfileImage';
import VideoCard from '@/components/VideoCard';
import { PlaylistIcon } from '@/components/ReactionIcons';
import { playlistCover } from '@/lib/playlistCover';
import { formatDuration } from '@/lib/homeRecommendation';

type Tab = 'home' | 'videos' | 'sparks' | 'posts' | 'playlists';

function ChannelPageInner() {
  const { t } = useLanguage();
  const params = useParams();
  const channelId = params.id as string;
  const { isModerator } = useUserRole();
  const [confirmBlockOpen, setConfirmBlockOpen] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [trustRating, setTrustRating] = useState<number | null>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  // Kolik příspěvků má kanál jen pro členy (zamčená dlaždice pro ostatní - bez obsahu).
  const [membersOnlyTotal, setMembersOnlyTotal] = useState(0);
  const [isNewCreator, setIsNewCreator] = useState(false);
  /** Podklady pro odznaky (lib/badges.ts) - vlastní zveřejněná videa, zhlédnutí, Sparks, vysílání. */
  const [badgeStats, setBadgeStats] = useState<BadgeStats | null>(null);
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

  // Skleněný vzhled "podle videa": na kanálu barvy z banneru (jinak z avataru).
  const ambientImage: string | null = profile?.banner_url || profile?.avatar_url || null;
  useEffect(() => {
    setAmbientSource(ambientImage);
  }, [ambientImage]);
  useEffect(() => () => setAmbientSource(null), []);

  // Majitel na svém kanálu: čísla jsou čerstvá - zkontrolovat nové odznaky hned (components/BadgeWatcher.tsx).
  useEffect(() => {
    if (userId && userId === channelId && badgeStats) window.dispatchEvent(new Event(BADGE_CHECK_EVENT));
  }, [userId, channelId, badgeStats]);

  async function load() {
    setLoading(true);
    const [{ data: authData }, { data: profileData }, { count }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, banner_url, bio, social_links, verification_tier, created_at, trailer_video_id, trailer:videos!profiles_trailer_video_id_fkey(id, title, cloudflare_video_id, thumbnail_url)')
        .eq('id', channelId)
        .single(),
      supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('channel_id', channelId),
    ]);

    setUserId(authData.user?.id ?? null);
    // Stav moderace (zablokován, shadow ban, pozastavené výplaty) se z
    // prohlížeče přečíst nedá - byl by vidět i tomu, koho se týká, a
    // shadow ban tím ztrácí smysl. Funkce ho vydá jen moderátorovi,
    // ostatním vrátí prázdno.
    // Vybrané odznaky (profiles.badge_showcase) zvlášť - bez migrace odznaků by výčet sloupců
    // výš spadl celý; takhle jen chybí výběr a ukážou se první tři.
    const [{ data: flagRows }, showcaseRes] = await Promise.all([
      supabase.rpc('moderation_flags', { channel_id: channelId }),
      supabase.from('profiles').select('badge_showcase').eq('id', channelId).maybeSingle(),
    ]);
    const flags: any = Array.isArray(flagRows) ? flagRows[0] : flagRows;
    const badgeShowcase = showcaseRes.error ? null : ((showcaseRes.data as any)?.badge_showcase ?? null);

    // Kanál neexistuje -> null (stránka napíše "Kanál nenalezen"); dřív tu byl vždycky objekt.
    setProfile(profileData ? { ...(profileData as any), ...(flags ?? {}), badge_showcase: badgeShowcase } : null);
    setSubscriberCount(count ?? 0);
    if (profileData) {
      channelTrust(profileData.id, profileData.created_at)
        .then(({ score, total }) => {
          if (total >= RATING_UNLOCK_THRESHOLD) setTrustRating(score);
        })
        .catch(() => {});
    }

    if (profileData) {
      // Naplánovaná videa (zveřejní se později) vidí jen majitel kanálu; premiéry
      // všichni jako "připravuje se" - stejně jako hlavní stránka (lib/scheduling.ts).
      // Soukromá videa na kanál nepatří ani pro majitele (jako na YouTube) - ta jsou
      // v "Tvoje videa". Dřív je majitel viděl mezi ostatními (třeba klipy, které
      // appka nahrála jako soukromé) s 0 zhlédnutími a bez náhledu.
      const ownChannel = authData.user?.id === channelId;
      let videosQuery = supabase
        .from('videos')
        .select('id, owner_id, title, thumbnail_url, views, width, height, duration_seconds, created_at, cloudflare_video_id, scheduled_at, is_premiere, visibility')
        .eq('owner_id', channelId)
        .eq('status', 'ready')
        .neq('visibility', 'private');
      if (!ownChannel) videosQuery = videosQuery.or(visibleNowFilter());
      const [{ data: videoData }, { data: collabRows }, { data: postData }, { data: playlistData }, { data: myPlaylists }, streamedRes] = await Promise.all([
        videosQuery.order('created_at', { ascending: false }),
        // Videa, kde je tenhle profil přidaný jako spolutvůrce - appka je
        // ukáže i tady, ne jen na kanálu toho, kdo je reálně nahrál. appka
        // schválně nefiltruje "accepted" přímo v appky dotazu, protože
        // "status" má i samotné video (ready/processing) - appka by tak
        // hrozilo nejednoznačné chování appky. Radši si to appka ověří
        // sama, jednoznačně, hned pod tím v appce.
        supabase
          .from('video_collaborators')
          .select('status, videos(id, owner_id, title, thumbnail_url, views, width, height, duration_seconds, created_at, status, cloudflare_video_id, visibility)')
          .eq('profile_id', channelId),
        supabase
          .from('posts')
          .select('*')
          .eq('owner_id', channelId)
          .order('created_at', { ascending: false }),
        supabase
          .from('playlists')
          .select('id, title, color, thumbnail_url, playlist_videos(video_id, position, videos(thumbnail_url))')
          .eq('owner_id', channelId)
          .eq('visibility', 'public')
          .eq('is_system', false)
          .order('created_at', { ascending: false }),
        authData.user
          ? supabase
              .from('playlists')
              .select('saved_from')
              .eq('owner_id', authData.user.id)
              .not('saved_from', 'is', null)
          : Promise.resolve({ data: [] }),
        // Vysílal živě? Záznam vysílání je video s live_started_at (bez migrace zive-2 chyba = ne).
        supabase.from('videos').select('id', { count: 'exact', head: true }).eq('owner_id', channelId).not('live_started_at', 'is', null),
      ]);

      const collabVideos = (collabRows ?? [])
        .filter((r: any) => r.status === 'accepted')
        .map((r: any) => r.videos)
        .filter((v: any) => v && v.status === 'ready' && v.visibility !== 'private');

      const mergedVideos = [...(videoData ?? []), ...collabVideos]
        .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setVideos(mergedVideos);
      // Odznaky jen z vlastních videí, která už jsou venku (naplánovaná vidí jen majitel - ta se nepočítají).
      // Hned z toho, co stránka má; všechny řady (lajky, hit, hodiny živě, příspěvky...) pak ze serveru.
      const published = (videoData ?? []).filter((v: any) => !v.scheduled_at || Date.parse(v.scheduled_at) <= Date.now());
      setBadgeStats({
        joinedAt: profileData.created_at ?? null,
        videos: published.length,
        views: published.reduce((sum: number, v: any) => sum + (Number(v.views) || 0), 0),
        subscribers: count ?? 0,
        sparks: published.filter((v: any) => isSpark(v)).length,
        streamed: !streamedRes.error && (streamedRes.count ?? 0) > 0,
        topVideoViews: published.reduce((max: number, v: any) => Math.max(max, Number(v.views) || 0), 0),
        posts: (postData ?? []).length,
      });
      // Nejvýš 8 s - odznaky z toho, co stránka už má, jsou vidět hned a čekání na server nic neblokuje.
      const statsAbort = new AbortController();
      const statsTimer = setTimeout(() => statsAbort.abort(), 8000);
      // Vlastní kanál bez mezipaměti (nový odznak od týmu Kine, právě vybrané) - cizí z CDN (5 min).
      fetch(`/api/badges/stats?channel=${encodeURIComponent(channelId)}${ownChannel ? '&fresh=1' : ''}`, { signal: statsAbort.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (body?.stats && typeof body.stats === 'object') setBadgeStats(body.stats as BadgeStats);
        })
        .catch(() => {
          // Bez serveru zůstanou odznaky z toho, co stránka má.
        })
        .finally(() => clearTimeout(statsTimer));
      setPosts(postData ?? []);
      // Bez migrace funkce chybí - pak žádná dlaždice.
      void supabase.rpc('members_only_post_count', { p_owner: channelId }).then(({ data: n, error: e }) => {
        setMembersOnlyTotal(!e && Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0);
      });
      setChannelPlaylists(playlistData ?? []);
      setSavedPlaylistIds(new Set((myPlaylists ?? []).map((p: any) => p.saved_from)));

      const allContentDates = [
        ...(videoData ?? []).map((v: any) => v.created_at),
        ...(postData ?? []).map((p: any) => p.created_at),
      ];
      if (allContentDates.length > 0) {
        const earliest = new Date(Math.min(...allContentDates.map((d) => new Date(d).getTime())));
        const daysSinceFirst = (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24);
        setIsNewCreator(daysSinceFirst <= 30);
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
  if (!profile) return <p>{t('channelNotFound')}</p>;

  const isOwner = userId === channelId;

  async function toggleBanUser() {
    const nextBanned = !profile.is_banned;
    const { error } = await supabase.from('profiles').update({ is_banned: nextBanned }).eq('id', channelId);
    setConfirmBlockOpen(false);
    if (!error) {
      setProfile((prev: any) => ({ ...prev, is_banned: nextBanned }));
      if (nextBanned) {
        await supabase.from('notifications').insert({
          user_id: channelId,
          type: 'moderation_warning',
          message: t('accountBannedWarningNote'),
          link: '/rules',
        });
      }
    }
  }

  async function toggleShadowBan() {
    const next = !profile.is_shadow_banned;
    const { error } = await supabase.from('profiles').update({ is_shadow_banned: next }).eq('id', channelId);
    if (!error) {
      setProfile((prev: any) => ({ ...prev, is_shadow_banned: next }));
      if (next) {
        await supabase.from('notifications').insert({
          user_id: channelId,
          type: 'moderation_warning',
          message: t('shadowBanWarningNote'),
          link: '/rules',
        });
      }
    }
  }

  async function togglePayoutsSuspended() {
    const next = !profile.payouts_suspended;
    const { error } = await supabase.from('profiles').update({ payouts_suspended: next }).eq('id', channelId);
    if (!error) {
      setProfile((prev: any) => ({ ...prev, payouts_suspended: next }));
      if (next) {
        await supabase.from('notifications').insert({
          user_id: channelId,
          type: 'moderation_warning',
          message: t('payoutsSuspendedWarningNote'),
          link: '/rules',
        });
      }
    }
  }
  const longVideos = videos.filter((v) => !isSpark(v));
  const sparkVideos = videos.filter(isSpark);

  function renderVideoGrid(list: any[]) {
    if (list.length === 0) {
      return <p style={{ color: 'var(--text-faint)' }}>{t('nothingToShowYet')}</p>;
    }
    return (
      <div className="video-grid">
        {list.map((video: any) => (
          <VideoCard key={video.id} video={video} href={`/watch/${video.id}`} formatDuration={formatDuration} hideCreator />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Hlavička kanálu: přes banner zasahuje jen profilovka, jméno a počty jsou pod ním.
          Dřív byl celý blok textu vytažený do banneru a na světlém banneru se ztrácel. */}
      <div className={`channel-banner ${profile.banner_url ? '' : 'empty'}`}>
        {profile.banner_url && <ProfileImage src={profile.banner_url} alt="" animate="always" eager />}
      </div>

      <div className="channel-head-row">
        <div className="creator-avatar channel-avatar">
          {profile.avatar_url ? <ProfileImage src={profile.avatar_url} alt={profile.username} animate="always" eager /> : null}
        </div>

        <div className="channel-info">
          <h1 className="channel-name">
            <span className="channel-name-text">{profile.display_name ?? profile.username}</span>
            <VerifiedBadge tier={profile.verification_tier} />
            <PlusBadge userId={profile.id} size="md" />
            {trustRating !== null && trustRating >= 90 && (
              <span className="channel-star" title={t('highRatingTitle').replace('{rating}', String(trustRating))}>
                <UiIcon name="starFilled" size={16} />
              </span>
            )}
            {(trustRating === null || trustRating < 90) && isNewCreator && (
              <span className="channel-badge channel-badge-new" title={t('newcomerBadgeTooltip')}>
                <UiIcon name="leaf" size={13} />
                {t('newcomerBadgeLabel')}
              </span>
            )}
          </h1>
          <p className="channel-meta">
            {profile.username ? <span>@{profile.username}</span> : null}
            <span>
              {subscriberCount} {t('subscribersSuffix')}
            </span>
            <span>
              {videos.length} {t('videosSuffix')}
            </span>
            {trustRating !== null && <span>Rating {trustRating}%</span>}
          </p>
          {badgeStats && (
            <ChannelBadges
              stats={badgeStats}
              own={isOwner}
              showcase={profile.badge_showcase ?? null}
              onShowcaseSaved={(next) => setProfile((prev: any) => ({ ...prev, badge_showcase: next }))}
              openOnLoad={isOwner && searchParams.get('badges') === '1'}
            />
          )}
          {/* Kanál právě vysílá živě - odkaz na přenos (jinak se nevykreslí nic). */}
          <div style={{ margin: '6px 0' }}>
            <LiveBadge channelId={profile.id} withTitle />
          </div>
          {profile.bio && <p className="channel-bio">{profile.bio}</p>}
          {profile.social_links && profile.social_links.length > 0 && (
            <div className="channel-links">
              {profile.social_links.map((link: { label: string; url: string }, i: number) => {
                // Odkaz si píše majitel kanálu, čte ho kdokoliv. Cokoliv
                // jiného než http(s) - hlavně "javascript:" - se zahodí.
                const href = safeExternalUrl(link.url);
                if (!href) return null;
                return (
                  <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="channel-link-chip">
                    <UiIcon name="link" size={12} />
                    {link.label}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <div className="channel-actions">
          <SubscribeButton channelId={profile.id} />
          <CreatorSubscribeButton creatorId={profile.id} />
          {isModerator && !isOwner && (
            <button
              onClick={() => setConfirmBlockOpen(true)}
              style={{
                background: 'var(--panel-raised)',
                color: profile.is_banned ? 'var(--text)' : '#ff6b6b',
                border: '1px solid var(--border)',
              }}
            >
              {profile.is_banned ? t('unblockUserButton') : t('blockUserButton')}
            </button>
          )}
          {isModerator && !isOwner && (
            <button
              onClick={toggleShadowBan}
              style={{
                background: profile.is_shadow_banned ? 'var(--panel-raised)' : 'transparent',
                color: 'var(--text-faint)',
                border: '1px solid var(--border)',
              }}
            >
              {profile.is_shadow_banned ? t('shadowBanActiveButton') : t('shadowBanButton')}
            </button>
          )}
          {isModerator && !isOwner && (
            <button
              onClick={togglePayoutsSuspended}
              style={{
                background: profile.payouts_suspended ? 'var(--panel-raised)' : 'transparent',
                color: 'var(--text-faint)',
                border: '1px solid var(--border)',
              }}
            >
              {profile.payouts_suspended ? t('payoutsSuspendedActiveButton') : t('suspendPayoutsButton')}
            </button>
          )}
        </div>
      </div>

      {confirmBlockOpen && (
        <ConfirmDialog
          message={t('confirmBlockUser')}
          onConfirm={toggleBanUser}
          onCancel={() => setConfirmBlockOpen(false)}
        />
      )}

      {!isOwner && profile.trailer && (
        <div style={{ marginBottom: 24 }}>
          <p className="panel-heading">{t('channelTrailerHeading')}</p>
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
            <VideoBlockRow key={i} type={block.type} style={{ marginBottom: 20 }}>
              {block.items.map((video: any) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  href={block.type === 'sparks' ? `/sparks?start=${video.id}` : `/watch/${video.id}`}
                  isSparks={block.type === 'sparks'}
                  formatDuration={formatDuration}
                  hideCreator
                />
              ))}
            </VideoBlockRow>
          ))}
          {videos.length === 0 && <p style={{ color: 'var(--text-faint)' }}>{t('channelHasNoVideos')}</p>}
        </div>
      )}

      {tab === 'videos' && renderVideoGrid(longVideos)}
      {tab === 'sparks' && (
        <div className="shorts-grid">
          {sparkVideos.map((video: any) => (
            <VideoCard key={video.id} video={video} href={`/sparks?start=${video.id}`} isSparks formatDuration={formatDuration} hideCreator />
          ))}
          {sparkVideos.length === 0 && <p style={{ color: 'var(--text-faint)' }}>{t('noSparksYet')}</p>}
        </div>
      )}

      {tab === 'posts' && (
        <div className="post-list">
          {isOwner && <PostComposer userId={userId!} onPosted={load} initialType={searchParams.get('compose') as 'text' | 'photo' | 'poll' | null} />}
          {(() => {
            // Příspěvky pro členy, které divák nevidí (není člen): jen počet a možnost se přidat.
            const locked = isOwner ? 0 : membersOnlyTotal - posts.filter((p) => p.members_only).length;
            if (locked <= 0 || !profile) return null;
            return (
              <div className="post-members-teaser">
                <span className="post-members-teaser-icon" aria-hidden="true">
                  <UiIcon name="lock" size={20} />
                </span>
                <div className="post-members-teaser-text">
                  <p className="post-members-teaser-title">{t('postMembersTeaserTitle').replace('{n}', String(locked))}</p>
                  <p className="post-members-teaser-sub">{t('postMembersTeaserSub')}</p>
                </div>
                <CreatorSubscribeButton creatorId={profile.id} />
              </div>
            );
          })()}
          {posts.length === 0 && !(membersOnlyTotal > 0 && !isOwner) ? (
            <p style={{ color: 'var(--text-faint)' }}>{t('noPostsYet')}</p>
          ) : (
            // Připnuté nahoře (lib/posts.ts - sortPosts).
            sortPosts(posts).map((post) => (
              <PostCard
                key={post.id}
                post={post}
                userId={userId}
                author={profile}
                onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
                onChanged={load}
              />
            ))
          )}
        </div>
      )}

      {tab === 'playlists' && (
        channelPlaylists.length === 0 ? (
          <p style={{ color: 'var(--text-faint)' }}>{t('creatorHasNoPublicPlaylists')}</p>
        ) : (
          <div className="video-grid">
            {channelPlaylists.map((p: any) => {
              const cover = playlistCover(p);
              return (
                <div key={p.id} className="playlist-card">
                  <Link href={`/playlists/${p.id}`} className="playlist-card-link">
                    <div className="playlist-cover" style={cover ? undefined : { background: `linear-gradient(135deg, ${p.color ?? '#3a3a40'}, #111114)` }}>
                      {cover ? <img loading="lazy" decoding="async" src={cover} alt="" /> : <PlaylistIcon size={34} />}
                      <span className="playlist-cover-count">
                        <PlaylistIcon size={14} />
                        {p.playlist_videos?.length ?? 0} {t('playlistVideoCountSuffix')}
                      </span>
                    </div>
                    <p className="video-card-title playlist-card-title">{p.title}</p>
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
              );
            })}
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
