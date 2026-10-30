'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { timeAgo } from '@/lib/timeAgo';
import { postImages } from '@/lib/posts';
import { trustedImageUrl } from '@/lib/trustedMedia';
import {
  SHELF_MAX_AGE_DAYS,
  homePostsEnabled,
  homePostsSnoozed,
  markPostSeen,
  pickShelfPosts,
  postExcerpt,
  seenPostIds,
  snoozeHomePosts,
} from '@/lib/homePosts';
import ProfileImage from './ProfileImage';
import UiIcon from './UiIcon';

type ShelfRow = {
  id: string;
  owner_id: string;
  created_at: string;
  type?: string | null;
  content?: string | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  poll_options?: unknown;
  members_only?: boolean | null;
  profiles?: { id: string; username: string | null; display_name: string | null; avatar_url: string | null } | null;
};

/** Kolik kanálů se bere do dotazu (adresa dotazu nesmí být nekonečně dlouhá). */
const MAX_CHANNELS = 150;

/**
 * „Novinky od tvých kanálů“ - nenápadná řada příspěvků na hlavní stránce
 * (pravidla v lib/homePosts.ts). Načítá se až po videích, nikdy je nebrzdí;
 * když není nic nového, nevykreslí se nic.
 */
export default function HomePostsShelf() {
  const { t, lang } = useLanguage();
  const [posts, setPosts] = useState<ShelfRow[] | null>(null);

  useEffect(() => {
    if (!homePostsEnabled() || homePostsSnoozed()) return;
    let alive = true;

    const load = async () => {
      const { data: auth } = await supabase.auth.getSession();
      const me = auth.session?.user?.id;
      if (!me || !alive) return;
      const { data: subs } = await supabase.from('subscriptions').select('channel_id').eq('subscriber_id', me).limit(MAX_CHANNELS);
      const channels = (subs ?? []).map((s: { channel_id: string }) => s.channel_id).filter(Boolean);
      if (channels.length === 0 || !alive) return;
      const since = new Date(Date.now() - SHELF_MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
      // Pravidla viditelnosti hlídá databáze (příspěvky pro členy vidí jen členové).
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles!posts_owner_id_fkey(id, username, display_name, avatar_url)')
        .in('owner_id', channels)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(40);
      if (!alive || error || !data) return;
      setPosts(pickShelfPosts(data as ShelfRow[], { seen: seenPostIds(), viewerId: me }));
    };

    // Až po videích: hlavní stránka má přednost (nečeká se na nic z téhle řady).
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (typeof w.requestIdleCallback === 'function') idle = w.requestIdleCallback(() => void load(), { timeout: 2500 });
    else timer = setTimeout(() => void load(), 900);
    return () => {
      alive = false;
      if (idle !== null) w.cancelIdleCallback?.(idle);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!posts || posts.length === 0) return null;

  return (
    <section className="home-posts" aria-label={t('homePostsTitle')}>
      <div className="home-posts-head">
        <p className="section-title">
          <UiIcon name="quote" size={16} />
          {t('homePostsTitle')}
        </p>
        <button
          type="button"
          className="home-posts-hide"
          title={t('homePostsHideHint')}
          onClick={() => {
            snoozeHomePosts();
            setPosts([]);
          }}
        >
          {t('homePostsHide')}
        </button>
      </div>
      <div className="home-posts-row">
        {posts.map((p) => {
          const author = p.profiles ?? null;
          const name = author?.display_name || author?.username || '';
          const images = postImages(p).filter((u) => trustedImageUrl(u) !== null);
          const text = postExcerpt(p.content);
          const pollCount = Array.isArray(p.poll_options) ? p.poll_options.length : 0;
          return (
            <Link key={p.id} href={`/post/${p.id}`} className="home-post-card" onClick={() => markPostSeen(p.id)}>
              <span className="home-post-top">
                {author?.avatar_url ? (
                  <ProfileImage src={author.avatar_url} className="home-post-avatar" />
                ) : (
                  <span className="home-post-avatar home-post-avatar-empty" aria-hidden="true">
                    {name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="home-post-name">{name}</span>
                <span className="home-post-time">{timeAgo(p.created_at, DATE_LOCALES[lang])}</span>
                {p.members_only && (
                  <span className="home-post-lock" title={t('postMembersOnly')}>
                    <UiIcon name="lock" size={12} />
                  </span>
                )}
              </span>
              <span className="home-post-body">
                <span className="home-post-text">
                  {text ||
                    (pollCount > 0 ? (
                      <span className="home-post-kind">
                        <UiIcon name="poll" size={14} /> {t('postPollTab')}
                      </span>
                    ) : images.length > 0 ? (
                      <span className="home-post-kind">
                        <UiIcon name="image" size={14} /> {t('postPhotoTab')}
                      </span>
                    ) : null)}
                </span>
                {images.length > 0 && (
                  <span className="home-post-thumb">
                    <img src={images[0]} alt="" loading="lazy" decoding="async" />
                    {images.length > 1 && <span className="home-post-thumb-more">+{images.length - 1}</span>}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
