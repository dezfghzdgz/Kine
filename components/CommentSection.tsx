'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ExpandableText from './ExpandableText';
import ConfirmDialog from './ConfirmDialog';
import AttachmentPicker from './AttachmentPicker';
import ReportModal from './ReportModal';
import { useLanguage } from '@/lib/i18n';

type Comment = {
  id: string;
  content: string;
  created_at: string;
  parent_id: string | null;
  timestamp_seconds: number | null;
  user_id: string;
  pinned: boolean;
  image_url: string | null;
  profiles: { username: string } | null;
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
};

const TABS = ['Popis', 'Flow', 'Technical'] as const;

const LANGUAGE_LABELS: Record<string, string> = {
  cs: 'Čeština', sk: 'Slovenština', en: 'Angličtina', de: 'Němčina', other: 'Jiný',
};

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Rozpozná v textu komentáře časy jako "1:23" nebo "01:23" a udělá z nich
// klikací odkazy, které přeskočí přehrávač na dané místo (jako na YouTube).
function renderCommentContent(content: string, onSeek?: (seconds: number) => void) {
  const parts = content.split(/(\b\d{1,2}:\d{2}\b|@[a-zA-Z0-9_]+)/g);
  return parts.map((part, i) => {
    const timeMatch = part.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch && onSeek) {
      const seconds = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
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

export default function CommentSection({
  videoId, description, video, ownerId, onSeek,
}: {
  videoId: string;
  description?: string | null;
  video?: VideoInfo;
  ownerId?: string;
  onSeek?: (seconds: number) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [newCommentImage, setNewCommentImage] = useState<File | string | null>(null);
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>('Popis');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lastPostedAt, setLastPostedAt] = useState(0);

  useEffect(() => {
    loadComments();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [videoId]);

  async function loadComments() {
    const { data: rawComments } = await supabase
      .from('comments')
      .select('id, content, created_at, parent_id, timestamp_seconds, user_id, pinned, image_url, profiles!comments_user_id_fkey(username)')
      .eq('video_id', videoId)
      .order('created_at', { ascending: false });

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
      alert('Moc rychle za sebou - počkej pár vteřin a zkus to znovu.');
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
      const ext = imageFile.name.split('.').pop();
      const path = `${authData.user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('comment-images').upload(path, imageFile);
      if (!uploadError) {
        const { data } = supabase.storage.from('comment-images').getPublicUrl(path);
        imageUrl = data.publicUrl;
      }
    }

    await supabase.from('comments').insert({
      video_id: videoId,
      user_id: authData.user.id,
      content: content.trim(),
      parent_id: parentId,
      image_url: imageUrl,
    });

    if (parentId) {
      const parentComment = comments.find((c) => c.id === parentId);
      if (parentComment && parentComment.user_id !== authData.user.id) {
        await supabase.from('notifications').insert({
          user_id: parentComment.user_id,
          message: 'Někdo odpověděl na tvůj komentář',
          link: `/watch/${videoId}`,
        });
      }
    } else if (ownerId && ownerId !== authData.user.id) {
      await supabase.from('notifications').insert({
        user_id: ownerId,
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

  async function toggleReaction(commentId: string, type: 'like' | 'dislike', currentReaction: 'like' | 'dislike' | null) {
    if (!userId) {
      router.push('/login');
      return;
    }
    if (currentReaction === type) {
      await supabase.from('comment_reactions').delete().eq('comment_id', commentId).eq('user_id', userId);
    } else {
      await supabase.from('comment_reactions').upsert({ comment_id: commentId, user_id: userId, type });
    }
    loadComments();
  }

  const flowComments = comments
    .filter((c) => !c.parent_id)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const repliesFor = (id: string) => comments.filter((c) => c.parent_id === id);

  return (
    <div className="panel">
      <p className="panel-heading">{t('comments')}</p>

      <div className="tab-row">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'Popis' ? t('description2') : tab === 'Flow' ? t('comments') : t('technicalTab')}
          </button>
        ))}
      </div>

      {activeTab === 'Popis' && (
        description ? (
          <ExpandableText text={description} />
        ) : (
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Tvůrce nepřidal žádný popis.</p>
        )
      )}

      {activeTab === 'Flow' && (
        <>
          <form onSubmit={(e) => postComment(e)} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <input
                type="text"
                placeholder={t('writeComment')}
                maxLength={2000}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                style={{ flex: 1, border: 'none', background: 'none' }}
              />
              <AttachmentPicker onSelect={setNewCommentImage} />
            </div>
            {newCommentImage && (
              <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>
                Attached: {typeof newCommentImage === 'string' ? 'GIF' : newCommentImage.name} <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setNewCommentImage(null)}>remove</span>
              </p>
            )}
            <button type="submit" disabled={posting} style={{ alignSelf: 'flex-start' }}>{t('postComment')}</button>
          </form>

          {flowComments.map((c) => (
            <div key={c.id} style={{ marginBottom: 18 }}>
              <div className="comment-row" style={{ marginBottom: 6 }}>
                <div className="comment-avatar" />
                <div style={{ flex: 1 }}>
                  <p className="comment-author">
                    {c.profiles?.username ?? 'uživatel'}
                    {c.pinned && <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · 📌 Připnuto</span>}
                  </p>
                  <p className="comment-text">{renderCommentContent(c.content, onSeek)}</p>
                  {c.image_url && (
                    <img src={c.image_url} alt="" style={{ maxWidth: 200, borderRadius: 8, marginTop: 6, display: 'block' }} />
                  )}
                  <div className="comment-actions">
                    <span
                      onClick={() => toggleReaction(c.id, 'like', c.myReaction)}
                      style={{ cursor: 'pointer', color: c.myReaction === 'like' ? 'var(--text)' : undefined }}
                    >
                      👍 {c.likeCount > 0 ? c.likeCount : ''}
                    </span>
                    <span
                      onClick={() => toggleReaction(c.id, 'dislike', c.myReaction)}
                      style={{ cursor: 'pointer', color: c.myReaction === 'dislike' ? 'var(--text)' : undefined }}
                    >
                      👎 {c.dislikeCount > 0 ? c.dislikeCount : ''}
                    </span>
                    <span style={{ cursor: 'pointer' }} onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)}>
                      {t('reply')}
                    </span>
                    {ownerId && ownerId === userId && (
                      <span style={{ cursor: 'pointer' }} onClick={() => pinComment(c.id, c.pinned)}>
                        {c.pinned ? 'Odepnout' : 'Připnout'}
                      </span>
                    )}
                    {(userId === c.user_id || userId === ownerId) && (
                      <span style={{ cursor: 'pointer' }} onClick={() => setConfirmDeleteId(c.id)}>
                        {t('delete')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {repliesFor(c.id).map((r) => (
                <div key={r.id} className="comment-row" style={{ marginLeft: 40, marginBottom: 6 }}>
                  <div className="comment-avatar" style={{ width: 24, height: 24 }} />
                  <div style={{ flex: 1 }}>
                    <p className="comment-author">{r.profiles?.username ?? 'uživatel'}</p>
                    <p className="comment-text">{renderCommentContent(r.content, onSeek)}</p>
                    <div className="comment-actions">
                      <span
                        onClick={() => toggleReaction(r.id, 'like', r.myReaction)}
                        style={{ cursor: 'pointer', color: r.myReaction === 'like' ? 'var(--text)' : undefined }}
                      >
                        👍 {r.likeCount > 0 ? r.likeCount : ''}
                      </span>
                      <span
                        onClick={() => toggleReaction(r.id, 'dislike', r.myReaction)}
                        style={{ cursor: 'pointer', color: r.myReaction === 'dislike' ? 'var(--text)' : undefined }}
                      >
                        👎 {r.dislikeCount > 0 ? r.dislikeCount : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {replyingTo === c.id && (
                <form
                  onSubmit={(e) => postComment(e, c.id)}
                  style={{ display: 'flex', gap: 8, marginLeft: 40, marginTop: 6 }}
                >
                  <input
                    type="text"
                    placeholder="Napiš odpověď…"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button type="submit" disabled={posting}>{t('postComment')}</button>
                </form>
              )}
            </div>
          ))}

          {flowComments.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('noCommentsYet')}</p>
          )}
        </>
      )}

      {activeTab === 'Technical' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Délka videa', formatDuration(video?.duration_seconds ?? null)],
            ['Kategorie', video?.category ?? '—'],
            ['Jazyk', video?.language ? (LANGUAGE_LABELS[video.language] ?? video.language) : '—'],
            ['Nahráno', video ? new Date(video.created_at).toLocaleDateString('cs-CZ') : '—'],
            ['Vhodné pro děti', video?.made_for_kids ? 'Ano' : 'Ne'],
            ['Viditelnost', video?.visibility === 'public' ? 'Veřejné' : video?.visibility === 'private' ? 'Soukromé' : 'Pro odběratele'],
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
