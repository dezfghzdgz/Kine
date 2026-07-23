'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function PostComposer({
  userId, onPosted, initialType,
}: {
  userId: string;
  onPosted: () => void;
  initialType?: 'text' | 'photo' | 'poll' | null;
}) {
  const { t } = useLanguage();
  const [type, setType] = useState<'text' | 'photo' | 'poll'>(initialType ?? 'text');
  const [content, setContent] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    setError(null);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentPostCount } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .gte('created_at', since24h);

    if ((recentPostCount ?? 0) >= 5) {
      setError(t('dailyPostLimitReached'));
      setPosting(false);
      return;
    }

    let imageUrl: string | null = null;
    if (type === 'photo' && imageFile) {
      const ext = imageFile.name.split('.').pop();
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('post-images').upload(path, imageFile);
      if (uploadError) {
        setError(`${t('imageUploadFailed')} ${uploadError.message}`);
        setPosting(false);
        return;
      }
      const { data } = supabase.storage.from('post-images').getPublicUrl(path);
      imageUrl = data.publicUrl;
    }

    const { error: insertError } = await supabase.from('posts').insert({
      owner_id: userId,
      type,
      content: content.trim() || null,
      image_url: imageUrl,
      poll_options: type === 'poll'
        ? pollOptions.filter((o) => o.trim()).map((o) => ({ text: o.trim(), votes: 0 }))
        : null,
    });

    if (insertError) {
      setError(`${t('publishFailed')} ${insertError.message}`);
      setPosting(false);
      return;
    }

    setContent('');
    setImageFile(null);
    setPollOptions(['', '']);
    setPosting(false);
    onPosted();
  }

  return (
    <form onSubmit={handleSubmit} className="panel" style={{ marginBottom: 20 }}>
      <div className="tab-row" style={{ marginBottom: 12 }}>
        <button type="button" className={`tab-btn ${type === 'text' ? 'active' : ''}`} onClick={() => setType('text')}>{t('postTextTab')}</button>
        <button type="button" className={`tab-btn ${type === 'photo' ? 'active' : ''}`} onClick={() => setType('photo')}>{t('postPhotoTab')}</button>
        <button type="button" className={`tab-btn ${type === 'poll' ? 'active' : ''}`} onClick={() => setType('poll')}>{t('postPollTab')}</button>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={type === 'poll' ? t('postPlaceholderPoll') : t('postPlaceholderText')}
        rows={2}
        style={{ marginBottom: 10 }}
      />

      {type === 'photo' && (
        <input
          type="file"
          accept="image/*,.gif"
          onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          style={{ marginBottom: 10 }}
        />
      )}

      {type === 'poll' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {pollOptions.map((opt, i) => (
            <input
              key={i}
              type="text"
              placeholder={`${t('pollOptionPlaceholder')} ${i + 1}`}
              value={opt}
              onChange={(e) => {
                const next = [...pollOptions];
                next[i] = e.target.value;
                setPollOptions(next);
              }}
            />
          ))}
          {pollOptions.length < 5 && (
            <button type="button" onClick={() => setPollOptions([...pollOptions, ''])} style={{ background: 'var(--panel-raised)', color: 'var(--text)', fontSize: 12 }}>
              {t('addPollOption')}
            </button>
          )}
        </div>
      )}

      <button type="submit" disabled={posting}>{posting ? t('publishing') : t('publish')}</button>
      {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
    </form>
  );
}
