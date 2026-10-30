'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ExpandableText from './ExpandableText';
import ConfirmDialog from './ConfirmDialog';
import AttachmentPicker from './AttachmentPicker';
import EmojiPicker from './EmojiPicker';
import { useUserRole } from '@/lib/useUserRole';
import SupporterBadge from './SupporterBadge';
import ReportModal from './ReportModal';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { categoryLabel } from '@/lib/categories';
import LoadFailed from './LoadFailed';
import { parseTimestamp, type Caption } from '@/lib/captions';
import TranscriptPanel from './TranscriptPanel';
import { timeAgo } from '@/lib/timeAgo';
import UiIcon from './UiIcon';
import ProfileImage from './ProfileImage';
import { ThumbsDownIcon, ThumbsUpIcon } from './ReactionIcons';
import { IMAGE_MAX_BYTES, imageUploadExt, imageUploadProblem } from '@/lib/imageUpload';
import { trustedImageUrl } from '@/lib/trustedMedia';

/** Kolik komentářů se ukáže naráz (další po kliknutí). */
const COMMENTS_PAGE = 20;

type Comment = {
  id: string;
  content: string;
  created_at: string;
  parent_id: string | null;
  timestamp_seconds: number | null;
  user_id: string;
  pinned: boolean;
  /** Srdíčko od tvůrce videa - "tohle se mi líbí", viditelné všem. */
  hearted_by_creator?: boolean | null;
  image_url: string | null;
  profiles: { username: string; display_name?: string | null; avatar_url?: string | null; is_supporter?: boolean } | null;
  likeCount: number;
  dislikeCount: number;
  myReaction: 'like' | 'dislike' | null;
};

type VideoInfo = {
  duration_seconds: number | null;
  category: string | null;
  language: string | null;
  created_at: string;
  made_for_kids: boolean;
  visibility: string;
  hashtags?: string[] | null;
  comments_disabled?: boolean;
};

const TABS = ['Popis', 'Flow', 'Prepis', 'Technical'] as const;

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Rozpozná v textu komentáře časy jako "1:23", "01:23" nebo "1:02:03" a udělá
// z nich klikací odkazy, které přeskočí přehrávač na dané místo (jako na YouTube).
function renderCommentContent(content: string, onSeek?: (seconds: number) => void) {
  const parts = content.split(/(\b\d{1,2}:\d{2}(?::\d{2})?\b|@[a-zA-Z0-9_]+)/g);
  return parts.map((part, i) => {
    const seconds = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part) ? parseTimestamp(part) : null;
    if (seconds !== null && onSeek) {
      return (
        <span
          key={i}
          onClick={() => onSeek(seconds)}
          style={{ color: 'var(--text)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
        >
          {part}
        </span>
      );
    }

    if (part.startsWith('@') && part.length > 1) {
      return (
        <Link key={i} href={`/u/${part.slice(1)}`} style={{ color: 'var(--text)', fontWeight: 600 }}>
          {part}
        </Link>
      );
    }

    return <span key={i}>{part}</span>;
  });
}

/** Komentář po změně vlastní reakce (počty i "moje"). */
function applyReaction(c: Comment, next: 'like' | 'dislike' | null): Comment {
  let { likeCount, dislikeCount } = c;
  if (c.myReaction === 'like') likeCount -= 1;
  if (c.myReaction === 'dislike') dislikeCount -= 1;
  if (next === 'like') likeCount += 1;
  if (next === 'dislike') dislikeCount += 1;
  return { ...c, likeCount: Math.max(0, likeCount), dislikeCount: Math.max(0, dislikeCount), myReaction: next };
}

export default function CommentSection({
  videoId, description, video, ownerId, onSeek, captions, getCurrentTime, header,
}: {
  videoId: string;
  description?: string | null;
  video?: VideoInfo;
  ownerId?: string;
  onSeek?: (seconds: number) => void;
  /** Titulky videa - z nich přepis (záložka jen když nějaké jsou). */
  captions?: Caption[] | null;
  /** Kde video právě je (zvýraznění řádku v přepisu). */
  getCurrentTime?: () => number;
  /** Hlavička karty (tvůrce videa): tvůrce a komentáře jsou v jedné kartě, ne ve dvou nalepených na sobě. */
  header?: ReactNode;
}) {
  const router = useRouter();
  const { t, lang } = useLanguage();
  const { isModerator } = useUserRole();
  const LANGUAGE_LABELS: Record<string, string> = {
    cs: t('langOptCzech'), sk: t('langOptSlovak'), en: t('langOptEnglish'), de: t('langOptGerman'),
    es: t('langOptSpanish'), pl: t('langOptPolish'), fr: t('langOptFrench'), uk: t('langOptUkrainian'),
    other: t('langOptOther'),
  };
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsDisabled, setCommentsDisabled] = useState(!!video?.comments_disabled);
  const [newComment, setNewComment] = useState('');
  const [newCommentImage, setNewCommentImage] = useState<File | string | null>(null);
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('Popis');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lastPostedAt, setLastPostedAt] = useState(0);
  // Proč se komentář neodeslal. Dřív se chyba nikam nepsala a komentář
  // prostě zmizel i s textem, který do něj člověk napsal.
  const [postError, setPostError] = useState<string | null>(null);
  // Komentáře se nepodařilo načíst. Bez tohohle se pod videem vykreslilo
  // "Zatím žádné komentáře" - i u videa, které jich má padesát.
  const [commentsFailed, setCommentsFailed] = useState(false);
  // Řazení (jako na YouTube) a kolik komentářů je vidět.
  const [sortMode, setSortMode] = useState<'top' | 'newest'>('top');
  const [visibleCount, setVisibleCount] = useState(COMMENTS_PAGE);
  // Rozbalené odpovědi (jako na YouTube jsou schované pod "Zobrazit odpovědi").
  const [openReplies, setOpenReplies] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadComments();
    setVisibleCount(COMMENTS_PAGE);
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [videoId]);

  async function loadComments() {
    setCommentsFailed(false);

    // Dva doslovné výběry, ne jeden skládaný: Supabase odvozuje typ
    // výsledku z textu výběru, a ze skládaného textu odvodí "chybu" -
    // build pak spadl na tom, že řádek nemá .id.
    const nacti = async (seSrdickem: boolean): Promise<{ data: any[] | null; error: { code?: string; message?: string } | null }> => {
      if (seSrdickem) {
        return supabase
          .from('comments')
          .select('id, content, created_at, parent_id, timestamp_seconds, user_id, pinned, hearted_by_creator, image_url, profiles!comments_user_id_fkey(username, display_name, avatar_url, is_supporter)')
          .eq('video_id', videoId)
          .order('created_at', { ascending: false });
      }
      return supabase
        .from('comments')
        .select('id, content, created_at, parent_id, timestamp_seconds, user_id, pinned, image_url, profiles!comments_user_id_fkey(username, display_name, avatar_url, is_supporter)')
        .eq('video_id', videoId)
        .order('created_at', { ascending: false });
    };

    let vysledek = await nacti(true);

    // Sloupec srdíčka přidává migrace supabase-migration-srdicko.sql. Dokud
    // neproběhla, dotaz s ním spadne (42703 = neznámý sloupec) - komentáře
    // se pak načtou bez něj a jen se neukazují srdíčka. Bez téhle zálohy by
    // migrace, která ještě neproběhla, sebrala všem všechny komentáře.
    const chybiSloupec =
      vysledek.error && (vysledek.error.code === '42703' || /hearted_by_creator/.test(vysledek.error.message ?? ''));
    if (chybiSloupec) vysledek = await nacti(false);

    const { data: rawComments, error } = vysledek;

    // Chyba se tu dřív nečetla vůbec. Při spadlém dotazu vyšlo z databáze
    // null, komentáře se přepsaly na prázdný seznam a pod videem se
    // objevilo "Zatím žádné komentáře" - tvůrce tak u svého videa viděl
    // nulu, i když jich tam byly desítky.
    if (error) {
      setCommentsFailed(true);
      return;
    }

    if (!rawComments) {
      setComments([]);
      return;
    }

    const { data: reactions } = await supabase
      .from('comment_reactions')
      .select('comment_id, user_id, type')
      .in('comment_id', rawComments.map((c) => c.id));

    const { data: authData } = await supabase.auth.getUser();
    const myId = authData.user?.id;

    const enriched = rawComments.map((c: any) => ({
      ...c,
      likeCount: (reactions ?? []).filter((r) => r.comment_id === c.id && (r.type ?? 'like') === 'like').length,
      dislikeCount: (reactions ?? []).filter((r) => r.comment_id === c.id && r.type === 'dislike').length,
      myReaction: (reactions ?? []).find((r) => r.comment_id === c.id && r.user_id === myId)?.type ?? null,
    }));

    setComments(enriched);
  }

  async function postComment(e: React.FormEvent, parentId: string | null = null) {
    e.preventDefault();
    const content = parentId ? replyText : newComment;
    const imageFile = parentId ? null : newCommentImage;
    if (!content.trim() && !imageFile) return;
    if (content.length > 2000) return;

    if (Date.now() - lastPostedAt < 3000) {
      setPostError(t('commentTooFast'));
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.push('/login');
      return;
    }

    setPosting(true);

    let imageUrl: string | null = null;
    if (typeof imageFile === 'string') {
      imageUrl = imageFile;
    } else if (imageFile) {
      // Úložiště pustí jen JPEG / PNG / WebP / GIF / AVIF do 10 MB (lib/imageUpload.ts).
      const problem = imageUploadProblem(imageFile, 'comment');
      if (problem) {
        setPosting(false);
        setPostError(problem === 'size' ? t('imageUploadTooBig').replace('{mb}', String(IMAGE_MAX_BYTES.comment / 1024 / 1024)) : t('imageUploadBadType'));
        return;
      }
      const ext = imageUploadExt(imageFile) ?? 'jpg';
      const path = `${authData.user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('comment-images').upload(path, imageFile, { contentType: imageFile.type || undefined });

      // Neúspěšný upload se dřív jen přeskočil: komentář odešel bez
      // obrázku, pole se vyprázdnila a nikdo se nedozvěděl, že se obrázek
      // ztratil. Radši komentář neodešleme, ať se dá zkusit znovu.
      if (uploadError) {
        setPosting(false);
        setPostError(t('commentImageFailed'));
        return;
      }

      const { data } = supabase.storage.from('comment-images').getPublicUrl(path);
      imageUrl = data.publicUrl;
    }

    const { error: commentError } = await supabase.from('comments').insert({
      video_id: videoId,
      user_id: authData.user.id,
      content: content.trim(),
      parent_id: parentId,
      image_url: imageUrl,
    });

    // Když se komentář neuložil, pole se nesmí vyprázdnit - jinak zmizí
    // i to, co člověk napsal, a on si myslí, že se komentář ztratil.
    if (commentError) {
      setPosting(false);
      // KN429 = strop rychlosti v databázi (10 komentářů za minutu).
      setPostError(commentError.code === 'KN429' ? t('commentTooFast') : t('commentFailed'));
      return;
    }

    // Povedlo se. Bez tohohle zůstala pod formulářem viset červená hláška
    // z předchozího neúspěšného pokusu, i když komentář mezitím prošel.
    setPostError(null);

    if (parentId) {
      const parentComment = comments.find((c) => c.id === parentId);
      if (parentComment && parentComment.user_id !== authData.user.id) {
        await supabase.from('notifications').insert({
          user_id: parentComment.user_id,
          type: 'comment_reply',
          message: t('commentReplyNotification'),
          link: `/watch/${videoId}`,
        });
      }
    } else if (ownerId && ownerId !== authData.user.id) {
      await supabase.from('notifications').insert({
        user_id: ownerId,
        type: 'comment_reply',
        message: 'Nový komentář na tvém videu',
        link: `/watch/${videoId}`,
      });
    }

    if (parentId) {
      setReplyText('');
      setReplyingTo(null);
    } else {
      setNewComment('');
      setNewCommentImage(null);
      setLastPostedAt(Date.now());
    }
    setPosting(false);
    loadComments();
  }

  async function toggleCommentsDisabled() {
    const next = !commentsDisabled;
    await supabase.from('videos').update({ comments_disabled: next }).eq('id', videoId);
    setCommentsDisabled(next);
  }

  async function deleteComment(commentId: string) {
    await supabase.from('comments').delete().eq('id', commentId);
    loadComments();
  }

  async function pinComment(commentId: string, currentlyPinned: boolean) {
    if (!ownerId) return;
    // Nejdřív odepneme případný jiný připnutý komentář na tomhle videu
    await supabase.from('comments').update({ pinned: false }).eq('video_id', videoId).eq('pinned', true);
    if (!currentlyPinned) {
      await supabase.from('comments').update({ pinned: true }).eq('id', commentId);
    }
    loadComments();
  }

  /**
   * Srdíčko od tvůrce. Jen majitel videa (hlídá to i databáze - pravidlo
   * "vlastník videa může upravit komentář na svém videu"). Když sloupec
   * v databázi ještě není (migrace neproběhla), akce tiše nic neudělá.
   */
  async function heartComment(commentId: string, currently: boolean) {
    if (!ownerId || ownerId !== userId) return;
    const { error } = await supabase.from('comments').update({ hearted_by_creator: !currently }).eq('id', commentId);
    if (!error) {
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, hearted_by_creator: !currently } : c)));
    }
  }

  async function toggleReaction(commentId: string, type: 'like' | 'dislike', currentReaction: 'like' | 'dislike' | null) {
    if (!userId) {
      router.push('/login');
      return;
    }
    // Hned na obrazovce (dřív se po každém kliknutí znovu stáhly všechny komentáře
    // i reakce - palec naskočil až za vteřinu i víc); databáze potom, při chybě znovu načíst.
    const next = currentReaction === type ? null : type;
    setComments((prev) => prev.map((c) => (c.id === commentId ? applyReaction(c, next) : c)));
    const { error } =
      next === null
        ? await supabase.from('comment_reactions').delete().eq('comment_id', commentId).eq('user_id', userId)
        : await supabase.from('comment_reactions').upsert({ comment_id: commentId, user_id: userId, type: next });
    if (error) loadComments();
  }

  // Připnutý první; pak podle řazení: "Nejlepší" = lajky mínus nelajky (srdíčko
  // od tvůrce navrch), při shodě novější; "Nejnovější" = podle času.
  const allTopLevel = comments
    .filter((c) => !c.parent_id)
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (sortMode === 'top') {
        const score = (c: Comment) => c.likeCount - c.dislikeCount + (c.hearted_by_creator ? 2 : 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const flowComments = allTopLevel.slice(0, visibleCount);
  // Odpovědi pod komentářem od nejstarší (rozhovor se čte shora dolů).
  const repliesFor = (id: string) =>
    comments.filter((c) => c.parent_id === id).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  function toggleReplies(id: string) {
    setOpenReplies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Jeden komentář (i odpověď): profilovka a jméno s odkazem na kanál, kdy, text, akce ikonami. */
  function renderComment(c: Comment, isReply: boolean) {
    const name = c.profiles?.display_name || c.profiles?.username || t('unknownUserFallback');
    const isCreator = !!ownerId && c.user_id === ownerId;
    const canModerate = !!ownerId && ownerId === userId;
    return (
      <div key={c.id} className={`comment-row${isReply ? ' comment-reply' : ''}`} data-anim-scope>
        <Link href={`/channel/${c.user_id}`} className="comment-avatar" tabIndex={-1} aria-hidden="true">
          {c.profiles?.avatar_url ? <ProfileImage src={c.profiles.avatar_url} /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
        </Link>
        <div className="comment-body">
          <p className="comment-author">
            <Link href={`/channel/${c.user_id}`} className={isCreator ? 'comment-author-name creator' : 'comment-author-name'}>
              {name}
            </Link>
            <SupporterBadge isSupporter={c.profiles?.is_supporter} />
            <span className="comment-time" title={new Date(c.created_at).toLocaleString(DATE_LOCALES[lang])}>
              {timeAgo(c.created_at, DATE_LOCALES[lang])}
            </span>
            {c.pinned && (
              <span className="comment-pinned">
                <UiIcon name="pin" size={12} />
                {t('pinnedLabel')}
              </span>
            )}
          </p>
          <p className="comment-text">{renderCommentContent(c.content, onSeek)}</p>
          {trustedImageUrl(c.image_url) && <img loading="lazy" decoding="async" src={trustedImageUrl(c.image_url)!} alt="" className="comment-image" />}
          <div className="comment-actions">
            <button
              type="button"
              className={`comment-action${c.myReaction === 'like' ? ' active' : ''}`}
              aria-pressed={c.myReaction === 'like'}
              aria-label={t('commentLike')}
              title={t('commentLike')}
              onClick={() => toggleReaction(c.id, 'like', c.myReaction)}
            >
              <ThumbsUpIcon size={15} filled={c.myReaction === 'like'} />
              {c.likeCount > 0 && <span>{c.likeCount}</span>}
            </button>
            <button
              type="button"
              className={`comment-action${c.myReaction === 'dislike' ? ' active' : ''}`}
              aria-pressed={c.myReaction === 'dislike'}
              aria-label={t('commentDislike')}
              title={t('commentDislike')}
              onClick={() => toggleReaction(c.id, 'dislike', c.myReaction)}
            >
              <ThumbsDownIcon size={15} filled={c.myReaction === 'dislike'} />
              {c.dislikeCount > 0 && <span>{c.dislikeCount}</span>}
            </button>
            {!isReply && (
              <button type="button" className="comment-action" onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}>
                <UiIcon name="reply" size={15} />
                <span>{t('reply')}</span>
              </button>
            )}
            {/* Majitel videa má místo štítku přepínač srdíčka (níž) - dvě srdíčka vedle sebe mátla. */}
            {c.hearted_by_creator && !canModerate && (
              <span className="creator-heart" title={t('creatorHeartLabel')} aria-label={t('creatorHeartLabel')}>
                <UiIcon name="heart" size={14} />
              </span>
            )}
            {canModerate && (
              <button
                type="button"
                className={`comment-action comment-action-heart${c.hearted_by_creator ? ' active' : ''}`}
                aria-pressed={!!c.hearted_by_creator}
                onClick={() => heartComment(c.id, !!c.hearted_by_creator)}
                title={c.hearted_by_creator ? t('creatorUnheartButton') : t('creatorHeartButton')}
                aria-label={c.hearted_by_creator ? t('creatorUnheartButton') : t('creatorHeartButton')}
              >
                <UiIcon name="heart" size={15} />
              </button>
            )}
            {canModerate && !isReply && (
              <button
                type="button"
                className={`comment-action${c.pinned ? ' active' : ''}`}
                onClick={() => pinComment(c.id, c.pinned)}
                title={c.pinned ? t('unpinButton') : t('pinButton')}
                aria-label={c.pinned ? t('unpinButton') : t('pinButton')}
              >
                <UiIcon name="pin" size={15} />
              </button>
            )}
            {(userId === c.user_id || userId === ownerId || isModerator) && (
              <button type="button" className="comment-action" onClick={() => setConfirmDeleteId(c.id)} title={t('delete')} aria-label={t('delete')}>
                <UiIcon name="trash" size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`panel${header ? ' discussion-panel' : ''}`}>
      {header ? <div className="discussion-head">{header}</div> : <p className="panel-heading">{t('comments')}</p>}

      <div className="tab-row">
        {TABS.filter((tab) => tab !== 'Prepis' || (captions?.length ?? 0) > 0).map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'Popis'
              ? t('description2')
              : tab === 'Flow'
                ? `${t('comments')}${comments.length > 0 ? ` (${comments.length})` : ''}`
                : tab === 'Prepis'
                  ? t('transcriptTab')
                  : t('technicalTab')}
          </button>
        ))}
      </div>

      {activeTab === 'Popis' && (
        <>
          {description ? (
            <ExpandableText text={description} />
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('noDescriptionProvidedNote')}</p>
          )}
          {video?.hashtags && video.hashtags.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {video.hashtags.map((h: string) => (
                <Link key={h} href={`/hashtag/${h}`} style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500 }}>
                  #{h}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'Flow' && (
        <>
          {isModerator && (
            <button
              type="button"
              onClick={toggleCommentsDisabled}
              style={{
                background: 'var(--panel-raised)', color: commentsDisabled ? '#ff6b6b' : 'var(--text-dim)',
                border: '1px solid var(--border)', fontSize: 12, marginBottom: 10,
              }}
            >
              {commentsDisabled ? t('enableCommentsButton') : t('disableCommentsButton')}
            </button>
          )}

          {commentsDisabled && !isModerator ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 18 }}>{t('commentsDisabledNote')}</p>
          ) : (
          <form onSubmit={(e) => postComment(e)} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            <div className="composer">
              <input
                type="text"
                className="composer-input"
                placeholder={t('writeComment')}
                aria-label={t('writeComment')}
                maxLength={2000}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
              />
              <span className="composer-tools">
                <EmojiPicker onSelect={(emoji) => setNewComment((v) => v + emoji)} />
                <AttachmentPicker onSelect={setNewCommentImage} />
              </span>
            </div>
            {newCommentImage && (
              <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>
                {t('attachedLabel')} {typeof newCommentImage === 'string' ? 'GIF' : newCommentImage.name} <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setNewCommentImage(null)}>{t('removeLabel')}</span>
              </p>
            )}
            <button type="submit" disabled={posting} style={{ alignSelf: 'flex-start' }}>{t('postComment')}</button>
            {postError && <p className="error-text" style={{ fontSize: 12.5 }}>{postError}</p>}
          </form>
          )}

          {allTopLevel.length > 1 && (
            <div className="comment-sort" role="group" aria-label={t('commentSortLabel')}>
              <button type="button" className={`search-chip ${sortMode === 'top' ? 'active' : ''}`} onClick={() => setSortMode('top')}>
                {t('commentSortTop')}
              </button>
              <button type="button" className={`search-chip ${sortMode === 'newest' ? 'active' : ''}`} onClick={() => setSortMode('newest')}>
                {t('commentSortNewest')}
              </button>
            </div>
          )}

          {flowComments.map((c) => {
            const replies = repliesFor(c.id);
            const repliesOpen = openReplies.has(c.id) || replyingTo === c.id;
            return (
              <div key={c.id} className="comment-thread">
                {renderComment(c, false)}
                {replies.length > 0 && (
                  <button
                    type="button"
                    className={`comment-replies-toggle${repliesOpen ? ' open' : ''}`}
                    aria-expanded={repliesOpen}
                    onClick={() => toggleReplies(c.id)}
                  >
                    <UiIcon name="chevronDown" size={14} />
                    {repliesOpen ? t('commentHideReplies') : t('commentShowReplies').replace('{n}', String(replies.length))}
                  </button>
                )}
                {repliesOpen && replies.map((r) => renderComment(r, true))}

                {replyingTo === c.id && (
                  <form onSubmit={(e) => postComment(e, c.id)} className="comment-reply-form">
                    <div className="composer composer-grow">
                      <input
                        type="text"
                        className="composer-input"
                        placeholder={t('replyPlaceholder')}
                        aria-label={t('replyPlaceholder')}
                        maxLength={2000}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        autoFocus
                      />
                      <EmojiPicker onSelect={(emoji) => setReplyText((v) => v + emoji)} />
                    </div>
                    <button type="submit" disabled={posting}>{t('postComment')}</button>
                    {postError && <p className="error-text" style={{ fontSize: 12.5 }}>{postError}</p>}
                  </form>
                )}
              </div>
            );
          })}

          {allTopLevel.length > flowComments.length && (
            <button
              type="button"
              className="reaction-btn"
              style={{ marginBottom: 12 }}
              onClick={() => setVisibleCount((n) => n + COMMENTS_PAGE)}
            >
              {t('commentsShowMore').replace('{count}', String(allTopLevel.length - flowComments.length))}
            </button>
          )}

          {commentsFailed ? (
            <LoadFailed onRetry={loadComments} />
          ) : (
            flowComments.length === 0 && (
              <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('noCommentsYet')}</p>
            )
          )}
        </>
      )}

      {activeTab === 'Prepis' && captions && captions.length > 0 && <TranscriptPanel captions={captions} onSeek={onSeek} getCurrentTime={getCurrentTime} />}

      {activeTab === 'Technical' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            [t('videoDurationLabel'), formatDuration(video?.duration_seconds ?? null)],
            [t('categoryLabel'), categoryLabel(video?.category, t)],
            [t('videoLanguageFieldLabel'), video?.language ? (LANGUAGE_LABELS[video.language] ?? video.language) : '—'],
            [t('uploadedLabel'), video ? new Date(video.created_at).toLocaleDateString(DATE_LOCALES[lang]) : '—'],
            [t('madeForKidsFieldLabel'), video?.made_for_kids ? t('yesLabel') : t('noLabel')],
            [t('visibilityLabel'), video?.visibility === 'public' ? t('shortVisibilityPublic') : video?.visibility === 'private' ? t('shortVisibilityPrivate') : t('shortVisibilitySubscribers')],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: 'var(--text-faint)' }}>{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          message={t('confirmDeleteComment')}
          onConfirm={() => { deleteComment(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
