'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import PostComments from './PostComments';
import ConfirmDialog from './ConfirmDialog';
import ProfileImage from './ProfileImage';
import VerifiedBadge from './VerifiedBadge';
import UiIcon from './UiIcon';
import { ThumbsUpIcon, ThumbsDownIcon } from './ReactionIcons';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { timeAgo } from '@/lib/timeAgo';
import { pollState, postImages, type PollOption } from '@/lib/posts';

export type PostAuthor = {
  id: string;
  username: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  verification_tier?: string | null;
};

/** Text příspěvku: @zmínky a odkazy klikací. */
function renderPostText(content: string) {
  return content.split(/(@[a-zA-Z0-9_]+|https?:\/\/[^\s]+)/g).map((part, i) => {
    if (part.startsWith('@') && part.length > 1) {
      return (
        <Link key={i} href={`/u/${part.slice(1)}`} className="post-mention">
          {part}
        </Link>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="post-link">
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * Příspěvek (text, fotky, anketa, video): kdo a kdy, text s odkazy, až 4
 * fotky (klik = velký náhled), video z Kine, anketa (konec, změna hlasu,
 * výsledky), palce, komentáře, sdílení. Majitel: připnout, upravit text,
 * smazat. Počty (palce, komentáře) se načtou, až když je karta vidět.
 */
export default function PostCard({
  post,
  userId,
  author,
  onDeleted,
  onChanged,
  startWithComments = false,
}: {
  post: any;
  userId: string | null;
  author?: PostAuthor | null;
  onDeleted?: (id: string) => void;
  onChanged?: () => void;
  /** Stránka jednoho příspěvku: komentáře rovnou otevřené. */
  startWithComments?: boolean;
}) {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const cardRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<PollOption[]>(Array.isArray(post.poll_options) ? post.poll_options : []);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(startWithComments);
  const [commentCount, setCommentCount] = useState(0);
  const [myReaction, setMyReaction] = useState<'like' | 'dislike' | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [dislikeCount, setDislikeCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(post.content ?? '');
  const [content, setContent] = useState<string>(post.content ?? '');
  const [editedAt, setEditedAt] = useState<string | null>(post.edited_at ?? null);
  const [pinnedAt, setPinnedAt] = useState<string | null>(post.pinned_at ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [video, setVideo] = useState<any | null>(null);

  const own = !!userId && userId === post.owner_id;
  const images = postImages(post);
  const poll = pollState({ options, endsAt: post.poll_ends_at ?? null, voted: myVote !== null, own });
  const name = author ? author.display_name || author.username || '' : '';

  // Počty až když je karta vidět (dlouhý seznam příspěvků = desítky dotazů naráz).
  useEffect(() => {
    const el = cardRef.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (post.type === 'poll') void loadVote();
    void loadCommentCount();
    void loadReactions();
    if (post.video_id) void loadVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, post.id]);

  async function loadVideo() {
    const { data } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, duration_seconds, visibility, status')
      .eq('id', post.video_id)
      .maybeSingle();
    if (data && data.status === 'ready') setVideo(data);
  }

  async function loadReactions() {
    const { data } = await supabase.from('post_reactions').select('user_id, reaction').eq('post_id', post.id);
    setLikeCount((data ?? []).filter((r) => r.reaction === 'like').length);
    setDislikeCount((data ?? []).filter((r) => r.reaction === 'dislike').length);
    const mine = (data ?? []).find((r) => r.user_id === userId);
    setMyReaction((mine?.reaction as 'like' | 'dislike') ?? null);
  }

  async function react(reaction: 'like' | 'dislike') {
    if (!userId) {
      router.push('/login');
      return;
    }
    // Hned na obrazovce, databáze potom (při chybě znovu načíst).
    const next = myReaction === reaction ? null : reaction;
    setLikeCount((n) => n - (myReaction === 'like' ? 1 : 0) + (next === 'like' ? 1 : 0));
    setDislikeCount((n) => n - (myReaction === 'dislike' ? 1 : 0) + (next === 'dislike' ? 1 : 0));
    setMyReaction(next);
    const { error } =
      next === null
        ? await supabase.from('post_reactions').delete().eq('post_id', post.id).eq('user_id', userId)
        : await supabase.from('post_reactions').upsert({ post_id: post.id, user_id: userId, reaction: next });
    if (error) void loadReactions();
  }

  async function loadVote() {
    if (!userId) return;
    const { data } = await supabase.from('post_votes').select('option_index').eq('post_id', post.id).eq('user_id', userId).maybeSingle();
    if (data) setMyVote(data.option_index);
  }

  async function loadCommentCount() {
    const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
    setCommentCount(count ?? 0);
  }

  async function vote(index: number) {
    if (!userId) {
      router.push('/login');
      return;
    }
    if (voting || !poll.canVote || myVote === index) return;
    setVoting(true);
    setVoteError(null);
    // Hlas zapíše a výsledky spočítá databáze (vote_post_poll) - i změnu hlasu a konec ankety.
    const { data, error } = await supabase.rpc('vote_post_poll', { p_post_id: post.id, p_option: index });
    if (!error && Array.isArray(data)) {
      setOptions(data as PollOption[]);
      setMyVote(index);
    } else if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883' || /vote_post_poll/.test(error.message ?? '');
      if (missing && myVote === null) {
        // Funkce v databázi ještě není (migrace bezpecnost-rijen) - postaru, jen první hlas.
        const { error: insertError } = await supabase.from('post_votes').insert({ post_id: post.id, user_id: userId, option_index: index });
        if (!insertError) {
          const updated = options.map((o, i) => (i === index ? { ...o, votes: (o.votes ?? 0) + 1 } : o));
          setOptions(updated);
          setMyVote(index);
        }
      } else {
        setVoteError(/skončil|ended/i.test(error.message ?? '') ? t('pollEnded') : t('pollVoteFailed'));
      }
    }
    setVoting(false);
  }

  async function togglePin() {
    setMenuOpen(false);
    setActionError(null);
    const next = pinnedAt ? null : new Date().toISOString();
    const { error } = await supabase.from('posts').update({ pinned_at: next }).eq('id', post.id);
    if (error) {
      setActionError(t('postActionFailed'));
      return;
    }
    setPinnedAt(next);
    onChanged?.();
  }

  async function saveEdit() {
    setActionError(null);
    const text = draft.trim();
    if (!text && images.length === 0 && post.type !== 'poll') return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('posts').update({ content: text || null, edited_at: now }).eq('id', post.id);
    if (error) {
      setActionError(t('postActionFailed'));
      return;
    }
    setContent(text);
    setEditedAt(now);
    setEditing(false);
  }

  async function remove() {
    setConfirmDelete(false);
    const { error } = await supabase.from('posts').delete().eq('id', post.id);
    if (error) {
      setActionError(t('postActionFailed'));
      return;
    }
    onDeleted?.(post.id);
  }

  async function share() {
    setMenuOpen(false);
    const url = `${window.location.origin}/post/${post.id}`;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ url, title: name ? `${name} · Kine` : 'Kine' });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // zrušené sdílení / schránka nejde
    }
  }

  return (
    <article ref={cardRef} className={`post-card panel${pinnedAt ? ' pinned' : ''}`} data-post-id={post.id}>
      <header className="post-head">
        {author && (
          <Link href={`/channel/${author.id}`} className="post-avatar" aria-hidden="true" tabIndex={-1}>
            {author.avatar_url ? <ProfileImage src={author.avatar_url} /> : <span>{(name || '?').slice(0, 1).toUpperCase()}</span>}
          </Link>
        )}
        <div className="post-head-text">
          {author && (
            <Link href={`/channel/${author.id}`} className="post-author">
              {name}
              <VerifiedBadge tier={author.verification_tier as any} />
            </Link>
          )}
          <span className="post-meta">
            <Link href={`/post/${post.id}`} className="post-time" title={new Date(post.created_at).toLocaleString(DATE_LOCALES[lang])}>
              {timeAgo(post.created_at, DATE_LOCALES[lang])}
            </Link>
            {editedAt && <span> · {t('postEdited')}</span>}
            {pinnedAt && (
              <span className="post-pinned">
                <UiIcon name="pin" size={12} />
                {t('postPinned')}
              </span>
            )}
          </span>
        </div>
        <div className="post-menu-wrap">
          <button type="button" className="icon-btn post-menu-btn" aria-label={t('postOptions')} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <UiIcon name="dots" size={18} />
          </button>
          {menuOpen && (
            <div className="post-menu" role="menu">
              <button type="button" role="menuitem" onClick={share}>
                <UiIcon name="link" size={16} />
                {t('postCopyLink')}
              </button>
              {own && (
                <>
                  <button type="button" role="menuitem" onClick={togglePin}>
                    <UiIcon name="pin" size={16} />
                    {pinnedAt ? t('postUnpin') : t('postPin')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setDraft(content);
                      setEditing(true);
                    }}
                  >
                    <UiIcon name="pencil" size={16} />
                    {t('postEdit')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDelete(true);
                    }}
                  >
                    <UiIcon name="trash" size={16} />
                    {t('postDelete')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {editing ? (
        <div className="post-edit">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={5000} aria-label={t('postEdit')} autoFocus />
          <div className="post-edit-actions">
            <button type="button" className="post-edit-save" onClick={saveEdit}>
              {t('save')}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        content && <p className="post-text">{renderPostText(content)}</p>
      )}

      {images.length > 0 && (
        <div className={`post-images post-images-${Math.min(images.length, 4)}`}>
          {images.slice(0, 4).map((src, i) => (
            <button key={src + i} type="button" className="post-image" onClick={() => setLightbox(i)} aria-label={t('postOpenImage')}>
              <img loading="lazy" decoding="async" src={src} alt="" />
            </button>
          ))}
        </div>
      )}

      {video && (
        <Link href={`/watch/${video.id}`} className="post-video">
          <span className="post-video-thumb">
            {video.thumbnail_url ? <img loading="lazy" decoding="async" src={video.thumbnail_url} alt="" /> : null}
            <UiIcon name="play" size={22} />
          </span>
          <span className="post-video-title">{video.title}</span>
        </Link>
      )}

      {post.type === 'poll' && options.length > 0 && (
        <div className="post-poll" role="group" aria-label={t('postPollTab')}>
          {options.map((opt, i) => {
            const percent = poll.total > 0 ? Math.round(((opt.votes ?? 0) / poll.total) * 100) : 0;
            const mine = myVote === i;
            return (
              <button
                key={i}
                type="button"
                className={`post-poll-option${poll.showResults ? ' results' : ''}${mine ? ' mine' : ''}${poll.winner === i && poll.ended ? ' winner' : ''}`}
                onClick={() => vote(i)}
                disabled={!poll.canVote || voting}
                aria-pressed={mine}
              >
                {poll.showResults && <span className="post-poll-bar" style={{ width: `${percent}%` }} aria-hidden="true" />}
                <span className="post-poll-label">
                  {mine && <UiIcon name="check" size={14} />}
                  {opt.text}
                </span>
                {poll.showResults && <span className="post-poll-percent">{percent} %</span>}
              </button>
            );
          })}
          <p className="post-poll-meta">
            {t('pollVotes').replace('{n}', String(poll.total))}
            {' · '}
            {poll.ended
              ? t('pollEnded')
              : poll.endsAt
                ? t('pollEndsIn').replace('{time}', timeAgo(poll.endsAt, DATE_LOCALES[lang]))
                : t('pollNoEnd')}
            {myVote !== null && poll.canVote && <span> · {t('pollChangeHint')}</span>}
          </p>
          {voteError && <p className="error-text" style={{ margin: 0 }}>{voteError}</p>}
        </div>
      )}

      <footer className="post-actions">
        <button type="button" className={`comment-action${myReaction === 'like' ? ' active' : ''}`} aria-pressed={myReaction === 'like'} aria-label={t('commentLike')} onClick={() => react('like')}>
          <ThumbsUpIcon filled={myReaction === 'like'} size={16} />
          {likeCount > 0 && <span>{likeCount}</span>}
        </button>
        <button type="button" className={`comment-action${myReaction === 'dislike' ? ' active' : ''}`} aria-pressed={myReaction === 'dislike'} aria-label={t('commentDislike')} onClick={() => react('dislike')}>
          <ThumbsDownIcon filled={myReaction === 'dislike'} size={16} />
          {dislikeCount > 0 && <span>{dislikeCount}</span>}
        </button>
        <button type="button" className={`comment-action${commentsOpen ? ' active' : ''}`} aria-expanded={commentsOpen} onClick={() => setCommentsOpen((v) => !v)}>
          <UiIcon name="chat" size={16} />
          <span>{commentCount > 0 ? commentCount : t('comments')}</span>
        </button>
        <button type="button" className="comment-action" onClick={share} aria-label={t('postCopyLink')}>
          <UiIcon name="share" size={16} />
          <span>{copied ? t('postLinkCopied') : t('share')}</span>
        </button>
      </footer>
      {actionError && <p className="error-text" style={{ margin: '6px 0 0' }}>{actionError}</p>}

      {commentsOpen && (
        <div className="post-comments">
          <PostComments postId={post.id} ownerId={post.owner_id} onCommentAdded={loadCommentCount} />
        </div>
      )}

      {lightbox !== null && images[lightbox] && (
        <div className="post-lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <img src={images[lightbox]} alt="" />
          <button type="button" className="icon-btn post-lightbox-close" aria-label={t('close')} onClick={() => setLightbox(null)}>
            <UiIcon name="close" size={18} />
          </button>
          {images.length > 1 && (
            <>
              <button
                type="button"
                className="icon-btn post-lightbox-prev"
                aria-label={t('postPrevImage')}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((i) => (i === null ? null : (i - 1 + images.length) % images.length));
                }}
              >
                <UiIcon name="chevronLeft" size={20} />
              </button>
              <button
                type="button"
                className="icon-btn post-lightbox-next"
                aria-label={t('postNextImage')}
                onClick={(e) => {
                  e.stopPropagation();
                  setLightbox((i) => (i === null ? null : (i + 1) % images.length));
                }}
              >
                <UiIcon name="chevronRight" size={20} />
              </button>
            </>
          )}
        </div>
      )}

      {confirmDelete && <ConfirmDialog message={t('postDeleteConfirm')} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />}
    </article>
  );
}
