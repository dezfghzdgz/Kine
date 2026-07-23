'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import AttachmentPicker from './AttachmentPicker';
import { useLanguage } from '@/lib/i18n';

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

export default function PostComments({ postId, onCommentAdded }: { postId: string; onCommentAdded: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | string | null>(null);
  const [posting, setPosting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [postId]);

  async function load() {
    const { data } = await supabase
      .from('comments')
      .select('id, content, image_url, created_at, user_id, profiles!comments_user_id_fkey(username)')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    setComments(data ?? []);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) { router.push('/login'); return; }
    if (!text.trim() && !imageFile) return;

    setPosting(true);
    let imageUrl: string | null = null;

    if (typeof imageFile === 'string') {
      imageUrl = imageFile;
    } else if (imageFile) {
      const ext = imageFile.name.split('.').pop();
      const path = `${authData.user.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('comment-images').upload(path, imageFile);
      if (!error) {
        const { data } = supabase.storage.from('comment-images').getPublicUrl(path);
        imageUrl = data.publicUrl;
      }
    }

    await supabase.from('comments').insert({
      post_id: postId,
      user_id: authData.user.id,
      content: text.trim(),
      image_url: imageUrl,
    });

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
            style={{ flex: 1, border: 'none', background: 'none' }}
          />
          <AttachmentPicker onSelect={setImageFile} />
        </div>
        {imageFile && (
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: 0 }}>
            Attached: {typeof imageFile === 'string' ? 'GIF' : imageFile.name} <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setImageFile(null)}>remove</span>
          </p>
        )}
        <button type="submit" disabled={posting} style={{ alignSelf: 'flex-start' }}>{t('postComment')}</button>
      </form>

      {comments.map((c) => (
        <div key={c.id} className="comment-row" style={{ marginBottom: 12 }}>
          <div className="comment-avatar" />
          <div style={{ flex: 1 }}>
            <p className="comment-author">{c.profiles?.username ?? 'uživatel'}</p>
            {c.content && <p className="comment-text">{renderWithMentions(c.content)}</p>}
            {c.image_url && (
              <img src={c.image_url} alt="" style={{ maxWidth: 200, borderRadius: 8, marginTop: 4 }} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
