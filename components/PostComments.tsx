'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import AttachmentPicker from './AttachmentPicker';
import EmojiPicker from './EmojiPicker';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { timeAgo } from '@/lib/timeAgo';
import UiIcon from './UiIcon';
import ProfileImage from './ProfileImage';
import ConfirmDialog from './ConfirmDialog';
import { IMAGE_MAX_BYTES, imageUploadExt, imageUploadProblem } from '@/lib/imageUpload';
import { trustedImageUrl } from '@/lib/trustedMedia';

function renderWithMentions(content: string) {
  return content.split(/(@[a-zA-Z0-9_]+)/g).map((part, i) =>
    part.startsWith('@') && part.length > 1 ? (
      <Link key={i} href={`/u/${part.slice(1)}`} style={{ color: 'var(--text)', fontWeight: 600 }}>
        {part}
      </Link>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function PostComments({ postId, ownerId, onCommentAdded }: { postId: string; ownerId?: string; onCommentAdded: () => void }) {
  const { t, lang } = useLanguage();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const router = useRouter();
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [postId]);

  async function load() {
    const { data } = await supabase
      .from('comments')
      .select('id, content, image_url, created_at, user_id, profiles!comments_user_id_fkey(username, display_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    setComments(data ?? []);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) { router.push('/login'); return; }
    if (!text.trim() && !imageFile) return;
    if (text.length > 2000) return;

    setPosting(true);
    setPostError(null);
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
      const { error } = await supabase.storage.from('comment-images').upload(path, imageFile, { contentType: imageFile.type || undefined });
      if (error) {
        // Komentář bez obrázku by tvůrce nečekal - radši nic neodeslat a ukázat proč.
        setPosting(false);
        setPostError(error.message);
        return;
      }
      const { data } = supabase.storage.from('comment-images').getPublicUrl(path);
      imageUrl = data.publicUrl;
    }

    const { error: commentError } = await supabase.from('comments').insert({
      post_id: postId,
      user_id: authData.user.id,
      content: text.trim(),
      image_url: imageUrl,
    });

    // Neuložený komentář nesmí zmizet z pole - dřív se pole vyprázdnilo
    // i při chybě a člověk si myslel, že komentář odešel.
    if (commentError) {
      setPosting(false);
      setPostError(commentError.code === 'KN429' ? t('commentTooFast') : t('commentFailed'));
      return;
    }

    setText('');
    setImageFile(null);
    setPosting(false);
    load();
    onCommentAdded();
  }

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <input
            type="text"
            placeholder={t('writeComment')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'none' }}
          />
          <EmojiPicker onSelect={(emoji) => setText((v) => v + emoji)} />
          <AttachmentPicker onSelect={setImageFile} />
        </div>
        {imageFile && (
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>
            {t('attachedLabel')} {typeof imageFile === 'string' ? 'GIF' : imageFile.name} <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setImageFile(null)}>{t('removeLabel')}</span>
          </p>
        )}
        {postError && <p className="error-text" style={{ fontSize: 12.5, margin: 0 }}>{postError}</p>}
        <button type="submit" disabled={posting} style={{ alignSelf: 'flex-start' }}>{t('postComment')}</button>
      </form>

      {comments.map((c) => {
        const name = c.profiles?.display_name || c.profiles?.username || t('unknownUserFallback');
        return (
          <div key={c.id} className="comment-row" data-anim-scope>
            <Link href={`/channel/${c.user_id}`} className="comment-avatar" tabIndex={-1} aria-hidden="true">
              {c.profiles?.avatar_url ? <ProfileImage src={c.profiles.avatar_url} /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
            </Link>
            <div className="comment-body">
              <p className="comment-author">
                <Link href={`/channel/${c.user_id}`} className={`comment-author-name${ownerId && c.user_id === ownerId ? ' creator' : ''}`}>
                  {name}
                </Link>
                <span className="comment-time" title={new Date(c.created_at).toLocaleString(DATE_LOCALES[lang])}>
                  {timeAgo(c.created_at, DATE_LOCALES[lang])}
                </span>
              </p>
              {c.content && <p className="comment-text">{renderWithMentions(c.content)}</p>}
              {trustedImageUrl(c.image_url) && <img loading="lazy" decoding="async" src={trustedImageUrl(c.image_url)!} alt="" className="comment-image" />}
              {userId && (userId === c.user_id || userId === ownerId) && (
                <div className="comment-actions">
                  <button type="button" className="comment-action" onClick={() => setConfirmDeleteId(c.id)} title={t('delete')} aria-label={t('delete')}>
                    <UiIcon name="trash" size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {confirmDeleteId && (
        <ConfirmDialog
          message={t('confirmDeleteComment')}
          onConfirm={async () => {
            const id = confirmDeleteId;
            setConfirmDeleteId(null);
            // Smaže jen to, co RLS dovolí (vlastní komentář; majitel příspěvku po migraci posty-ankety).
            const { data: gone, error } = await supabase.from('comments').delete().eq('id', id).select('id');
            if (!error && gone && gone.length > 0) {
              setComments((prev) => prev.filter((x) => x.id !== id));
              onCommentAdded();
            }
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
