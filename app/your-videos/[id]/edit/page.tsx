'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

export default function EditVideoPage() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const videoId = params.id as string;

  const [checking, setChecking] = useState(true);
  const [notAllowed, setNotAllowed] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [newThumbnailFile, setNewThumbnailFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'private' | 'subscribers'>('public');
  const [isTrailer, setIsTrailer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    load();
  }, [videoId]);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      router.push('/login');
      return;
    }

    const { data: video } = await supabase
      .from('videos')
      .select('id, title, description, thumbnail_url, owner_id, visibility')
      .eq('id', videoId)
      .single();

    if (!video || video.owner_id !== authData.user.id) {
      setNotAllowed(true);
      setChecking(false);
      return;
    }

    setTitle(video.title ?? '');
    setDescription(video.description ?? '');
    setThumbnailUrl(video.thumbnail_url ?? null);
    setVisibility((video.visibility as 'public' | 'private' | 'subscribers') ?? 'public');

    const { data: myProfile } = await supabase.from('profiles').select('trailer_video_id').eq('id', authData.user.id).single();
    setIsTrailer(myProfile?.trailer_video_id === videoId);
    setChecking(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    let newThumbnailUrl = thumbnailUrl;

    if (newThumbnailFile) {
      const ext = newThumbnailFile.name.split('.').pop();
      const path = `${authData.user.id}/${videoId}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('thumbnails')
        .upload(path, newThumbnailFile, { upsert: true });

      if (uploadError) {
        setToast({ message: 'Nahrání náhledu se nepovedlo: ' + uploadError.message, type: 'error' });
        setSaving(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from('thumbnails').getPublicUrl(path);
      newThumbnailUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    }

    const { error } = await supabase
      .from('videos')
      .update({
        title,
        description,
        thumbnail_url: newThumbnailUrl,
        custom_thumbnail: newThumbnailFile ? true : undefined,
        visibility,
      })
      .eq('id', videoId);

    setSaving(false);

    if (error) {
      setToast({ message: 'Uložení se nepovedlo: ' + error.message, type: 'error' });
      return;
    }

    if (isTrailer) {
      await supabase.from('profiles').update({ trailer_video_id: videoId }).eq('id', authData.user.id);
    } else {
      await supabase.from('profiles').update({ trailer_video_id: null }).eq('id', authData.user.id).eq('trailer_video_id', videoId);
    }

    setToast({ message: 'Video bylo upraveno', type: 'success' });
    setTimeout(() => router.push(`/watch/${videoId}`), 900);
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (notAllowed) {
    return (
      <div className="auth-gate">
        <p>Tohle video buď neexistuje, nebo ho nemůžeš upravovat.</p>
        <Link href="/your-videos">Zpátky na Vaše videa →</Link>
      </div>
    );
  }

  return (
    <form className="form-container" style={{ maxWidth: 480 }} onSubmit={handleSave}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <h1>{t('editVideoTitle')}</h1>

      <div className="panel">
        <p className="panel-heading">Náhledový obrázek</p>
        {thumbnailUrl && (
          <img src={thumbnailUrl} alt="náhled" style={{ width: '100%', borderRadius: 8, marginBottom: 10 }} />
        )}
        <input type="file" accept="image/*" onChange={(e) => setNewThumbnailFile(e.target.files?.[0] ?? null)} />
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>Název videa</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>Popis</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </div>
      </div>

      <div className="panel">
        <p className="panel-heading">Kdo může video vidět</p>
        {([
          ['public', 'Veřejné - uvidí ho všichni'],
          ['subscribers', 'Jen pro odběratele'],
          ['private', 'Soukromé - jen já'],
        ] as [typeof visibility, string][]).map(([value, label]) => (
          <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input type="radio" name="visibility" style={{ width: 'auto' }} checked={visibility === value} onChange={() => setVisibility(value)} />
            {label}
          </label>
        ))}
      </div>

      <div className="panel">
        <p className="panel-heading">Upoutávka kanálu</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={isTrailer} onChange={(e) => setIsTrailer(e.target.checked)} />
          Ukázat tohle video nahoře na mém kanálu novým návštěvníkům
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Link href="/your-videos" style={{ flex: 1 }}>
          <button type="button" style={{ width: '100%', background: 'var(--panel-raised)', color: 'var(--text)' }}>
            {t('cancel')}
          </button>
        </Link>
        <button type="submit" disabled={saving} style={{ flex: 1 }}>
          {saving ? t('saving') : t('saveChanges')}
        </button>
      </div>
    </form>
  );
}
