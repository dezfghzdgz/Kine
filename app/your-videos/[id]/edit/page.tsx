'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

// Na jednom videu se můžou podílet nejvýš 4 tvůrci - ten, kdo ho nahrál,
// a k tomu tři spolutvůrci. Všichni čtyři se pak ukazují pod videem.
const MAX_VIDEO_CREATORS = 4;
const MAX_COLLABORATORS = MAX_VIDEO_CREATORS - 1;

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
  const [videoOwnerId, setVideoOwnerId] = useState<string | null>(null);
  const [isTrailer, setIsTrailer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [collaborators, setCollaborators] = useState<{ id: string; username: string; avatar_url: string | null; status: string }[]>([]);
  const [collabSearch, setCollabSearch] = useState('');
  const [collabResults, setCollabResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [collabError, setCollabError] = useState<string | null>(null);

  async function loadCollaborators() {
    const { data } = await supabase
      .from('video_collaborators')
      .select('status, profiles(id, username, avatar_url)')
      .eq('video_id', videoId);
    setCollaborators((data ?? []).map((c: any) => c.profiles && { ...c.profiles, status: c.status }).filter(Boolean));
  }

  async function searchCollaborators(query: string) {
    setCollabSearch(query);
    if (query.trim().length < 2) {
      setCollabResults([]);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${query.trim()}%`)
      .limit(6);
    setCollabResults((data ?? []).filter((p: any) => p.id !== videoOwnerId && !collaborators.some((c) => c.id === p.id)));
  }

  async function addCollaborator(profileId: string) {
    setCollabError(null);
    if (!videoOwnerId) return;

    // Na jednom videu se můžou podílet nejvýš 4 lidi - vlastník a tři další.
    if (collaborators.length >= MAX_COLLABORATORS) {
      setCollabError(t('collabLimitReachedNote').replace('{max}', String(MAX_VIDEO_CREATORS)));
      return;
    }

    if (profileId === videoOwnerId) {
      setCollabError(t('collabCannotAddYourselfNote'));
      return;
    }

    // Spolupráci jde nabídnout jen tomu, koho vzájemně odebíráte - ať appku
    // někdo nemůže takhle spamovat cizí lidi.
    const { data: mutualCheck } = await supabase
      .from('subscriptions')
      .select('subscriber_id, channel_id')
      .or(`and(subscriber_id.eq.${videoOwnerId},channel_id.eq.${profileId}),and(subscriber_id.eq.${profileId},channel_id.eq.${videoOwnerId})`);

    const iSubscribeToThem = (mutualCheck ?? []).some((s) => s.subscriber_id === videoOwnerId && s.channel_id === profileId);
    const theySubscribeToMe = (mutualCheck ?? []).some((s) => s.subscriber_id === profileId && s.channel_id === videoOwnerId);

    if (!iSubscribeToThem || !theySubscribeToMe) {
      setCollabError(t('mutualSubscriptionRequiredNote'));
      return;
    }

    const { data: currentVideo } = await supabase
      .from('videos')
      .select('visibility, pending_collab_visibility')
      .eq('id', videoId)
      .single();

    // Video appka schová jako soukromé, dokud spolutvůrce nepotvrdí - jeho
    // skutečně zvolenou viditelnost si appka pamatuje, aby ji šlo vrátit zpět.
    if (currentVideo && currentVideo.visibility !== 'private' && !currentVideo.pending_collab_visibility) {
      await supabase
        .from('videos')
        .update({ visibility: 'private', pending_collab_visibility: currentVideo.visibility })
        .eq('id', videoId);
      setVisibility('private');
    }

    // Chyby se dřív spolkly a tvůrci to vypadalo, že se nestalo vůbec nic.
    const { error: insertError } = await supabase
      .from('video_collaborators')
      .insert({ video_id: videoId, profile_id: profileId, status: 'pending' });

    if (insertError) {
      setCollabError(insertError.message);
      return;
    }

    const { error: notifyError } = await supabase.from('notifications').insert({
      user_id: profileId,
      type: 'collab_invite',
      message: t('collabInviteMessage').replace('{title}', title),
      link: `/watch/${videoId}`,
    });

    if (notifyError) setCollabError(notifyError.message);

    setCollabSearch('');
    setCollabResults([]);
    loadCollaborators();
  }

  async function removeCollaborator(profileId: string) {
    await supabase.from('video_collaborators').delete().eq('video_id', videoId).eq('profile_id', profileId);
    await releasePendingVisibility();
    loadCollaborators();
  }

  /**
   * Dokud video čeká na potvrzení spolupráce, drží ho appka jako soukromé.
   * Jakmile už nikdo nečeká - všichni potvrdili, nebo jsi je odebral -
   * vrátí se viditelnost, kterou jsi původně zvolil. Dřív video zůstalo
   * soukromé napořád a nešlo poznat proč.
   */
  async function releasePendingVisibility() {
    const { data: stillPending } = await supabase
      .from('video_collaborators')
      .select('profile_id')
      .eq('video_id', videoId)
      .eq('status', 'pending');

    if (stillPending && stillPending.length > 0) return;

    const { data: currentVideo } = await supabase
      .from('videos')
      .select('pending_collab_visibility')
      .eq('id', videoId)
      .maybeSingle();

    if (currentVideo?.pending_collab_visibility) {
      await supabase
        .from('videos')
        .update({ visibility: currentVideo.pending_collab_visibility, pending_collab_visibility: null })
        .eq('id', videoId);
      setVisibility(currentVideo.pending_collab_visibility);
    }
  }

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
    setVideoOwnerId(video.owner_id);

    const { data: myProfile } = await supabase.from('profiles').select('trailer_video_id').eq('id', authData.user.id).single();
    setIsTrailer(myProfile?.trailer_video_id === videoId);
    loadCollaborators();
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
        <p>{t('videoNotFoundOrCannotEditNote')}</p>
        <Link href="/your-videos">{t('backToYourVideosLink')}</Link>
      </div>
    );
  }

  return (
    <form className="form-container" style={{ maxWidth: 480 }} onSubmit={handleSave}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <h1>{t('editVideoTitle')}</h1>

      <div className="panel">
        <p className="panel-heading">{t('thumbnailImageLabel')}</p>
        {thumbnailUrl && (
          <img loading="lazy" decoding="async" src={thumbnailUrl} alt={t('thumbnailImageLabel')} style={{ width: '100%', borderRadius: 8, marginBottom: 10 }} />
        )}
        <input type="file" accept="image/*" onChange={(e) => setNewThumbnailFile(e.target.files?.[0] ?? null)} />
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('videoTitle')}</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>{t('description2')}</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </div>
      </div>

      <div className="panel">
        <p className="panel-heading">{t('whoCanSeeVideo')}</p>
        {([
          ['public', t('visibilityPublic')],
          ['subscribers', t('visibilitySubscribers')],
          ['private', t('visibilityPrivate')],
        ] as [typeof visibility, string][]).map(([value, label]) => (
          <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input type="radio" name="visibility" style={{ width: 'auto' }} checked={visibility === value} onChange={() => setVisibility(value)} />
            {label}
          </label>
        ))}
      </div>

      <div className="panel">
        <p className="panel-heading">{t('channelTrailerLabel')}</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={isTrailer} onChange={(e) => setIsTrailer(e.target.checked)} />
          {t('showAsTrailerLabel')}
        </label>
      </div>

      <div className="panel">
        <p className="panel-heading">
          {t('collaboratorsLabel')}
          <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 12, marginLeft: 8 }}>
            {collaborators.length + 1}/{MAX_VIDEO_CREATORS}
          </span>
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>{t('collaboratorsHint')}</p>

        {collaborators.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {collaborators.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="profile-avatar-small" style={{ width: 26, height: 26, overflow: 'hidden' }}>
                  {c.avatar_url ? <img loading="lazy" decoding="async" src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </span>
                <span style={{ fontSize: 13, flex: 1 }}>
                  {c.username}
                  {c.status === 'pending' && (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 6 }}>({t('pendingInviteLabel')})</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeCollaborator(c.id)}
                  style={{ background: 'none', color: 'var(--text-faint)', padding: 4, fontSize: 12 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          type="text"
          placeholder={t('searchUsernamePlaceholder')}
          value={collabSearch}
          onChange={(e) => searchCollaborators(e.target.value)}
          disabled={collaborators.length >= MAX_COLLABORATORS}
        />
        {collaborators.length >= MAX_COLLABORATORS && (
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
            {t('collabLimitReachedNote').replace('{max}', String(MAX_VIDEO_CREATORS))}
          </p>
        )}
        {collabResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {collabResults.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => addCollaborator(r.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-raised)',
                  border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', textAlign: 'left',
                }}
              >
                <span className="profile-avatar-small" style={{ width: 22, height: 22, overflow: 'hidden', flexShrink: 0 }}>
                  {r.avatar_url ? <img loading="lazy" decoding="async" src={r.avatar_url} alt={r.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{r.username}</span>
              </button>
            ))}
          </div>
        )}
        {collabError && <p className="error-text" style={{ marginTop: 8 }}>{collabError}</p>}
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
