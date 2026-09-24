'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';
import { autoCaptionLanguage, chaptersFromDescription, parseSubtitles, sanitizeCaptions, sanitizeChapters, toSrt } from '@/lib/captions';

// Na jednom videu se můžou podílet nejvýš 4 tvůrci - ten, kdo ho nahrál,
// a k tomu tři spolutvůrci. Všichni čtyři se pak ukazují pod videem.
const MAX_VIDEO_CREATORS = 4;
const MAX_COLLABORATORS = MAX_VIDEO_CREATORS - 1;

function formatChapterTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

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
  // Kapitoly ("0:00 Úvod" po řádcích) a titulky (formát SRT) - obojí jde upravit i po nahrání.
  const [chaptersText, setChaptersText] = useState('');
  const [captionsText, setCaptionsText] = useState('');
  const [videoLanguage, setVideoLanguage] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [autoCaptions, setAutoCaptions] = useState<'idle' | 'working' | 'unsupported' | 'error'>('idle');

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
      await syncProtection(videoId);
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
      .select('*')
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
    setChaptersText(
      sanitizeChapters(video.chapters)
        .map((c) => `${formatChapterTime(c.time)} ${c.title}`)
        .join('\n')
    );
    setCaptionsText(toSrt(sanitizeCaptions(video.captions)));
    setVideoLanguage(video.language ?? null);
    setVideoReady(video.status === 'ready');

    const { data: myProfile } = await supabase.from('profiles').select('trailer_video_id').eq('id', authData.user.id).single();
    setIsTrailer(myProfile?.trailer_video_id === videoId);
    loadCollaborators();
    setChecking(false);
  }

  /** Srovná ochranu videa podepsanými adresami s jeho viditelností (server). */
  async function syncProtection(id: string): Promise<'ok' | 'failed' | 'skipped'> {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) return 'skipped';
      const res = await fetch('/api/videos/protect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ videoId: id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return 'failed';
      return body.outcome === 'failed' ? 'failed' : 'ok';
    } catch {
      return 'failed';
    }
  }

  /** Automatické titulky (Cloudflare AI): požádat, pak se ptát, dokud nejsou hotové; výsledek jde do pole k úpravě. */
  async function generateCaptions() {
    const language = autoCaptionLanguage(videoLanguage);
    if (!language) {
      setAutoCaptions('unsupported');
      return;
    }
    setAutoCaptions('working');
    const { data: sessionData } = await supabase.auth.getSession();
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token ?? ''}` };
    const call = async (action: 'generate' | 'status') => {
      const res = await fetch('/api/videos/captions', { method: 'POST', headers, body: JSON.stringify({ videoId, action, language }) });
      return res.json().catch(() => ({ status: 'error' }));
    };
    const started = await call('generate');
    if (started.status === 'error' || started.error) {
      setAutoCaptions('error');
      return;
    }
    // Minutové video trvá Cloudflare zhruba desítky vteřin; ptát se nejvýš ~10 minut.
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const state = await call('status');
      if (state.status === 'ready' && Array.isArray(state.captions)) {
        setCaptionsText(toSrt(state.captions));
        setAutoCaptions('idle');
        setToast({ message: t('captionsGeneratedNote'), type: 'success' });
        return;
      }
      if (state.status === 'error') {
        setAutoCaptions('error');
        return;
      }
    }
    setAutoCaptions('error');
  }

  async function importCaptionsFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const parsed = parseSubtitles(text);
    if (parsed.length === 0) {
      setToast({ message: t('captionsImportFailed'), type: 'error' });
      return;
    }
    setCaptionsText(toSrt(parsed));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    // Kapitoly: stejná pravidla jako kapitoly z popisu (první na 0:00, aspoň dvě).
    const chapterLines = chaptersText.trim();
    const chapters = chapterLines ? chaptersFromDescription(chapterLines) : [];
    if (chapterLines && chapters.length === 0) {
      setToast({ message: t('chaptersInvalidNote'), type: 'error' });
      return;
    }
    const captions = captionsText.trim() ? parseSubtitles(captionsText) : [];
    if (captionsText.trim() && captions.length === 0) {
      setToast({ message: t('captionsImportFailed'), type: 'error' });
      return;
    }

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
        setToast({ message: t('thumbnailUploadFailedNote').replace('{message}', uploadError.message), type: 'error' });
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
        chapters,
        captions,
      })
      .eq('id', videoId);

    setSaving(false);

    if (error) {
      setToast({ message: t('saveFailedNote').replace('{message}', error.message), type: 'error' });
      return;
    }

    // Soukromé video a video pro odběratele dostanou podepsané adresy,
    // veřejné se zase otevře (lib/streamProtection.ts). Bez nastaveného
    // klíče server nic nedělá. Když to nevyjde, tvůrce to má vědět.
    const protection = await syncProtection(videoId);
    if (protection === 'failed') {
      setToast({ message: t('videoProtectionFailedNote'), type: 'error' });
      return;
    }

    if (isTrailer) {
      await supabase.from('profiles').update({ trailer_video_id: videoId }).eq('id', authData.user.id);
    } else {
      await supabase.from('profiles').update({ trailer_video_id: null }).eq('id', authData.user.id).eq('trailer_video_id', videoId);
    }

    setToast({ message: t('videoUpdatedNote'), type: 'success' });
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
          <label htmlFor="edit-title" style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>{t('videoTitle')}</label>
          <input id="edit-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required style={{ width: '100%' }} />
        </div>
        <div>
          <label htmlFor="edit-description" style={{ display: 'block', fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>{t('description2')}</label>
          <textarea id="edit-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={7} maxLength={5000} style={{ width: '100%' }} />
        </div>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="panel-heading" style={{ margin: 0 }}>{t('chapters')}</p>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{t('chaptersEditHint')}</p>
        <textarea
          value={chaptersText}
          onChange={(e) => setChaptersText(e.target.value)}
          rows={4}
          placeholder={'0:00 ' + t('chapterExampleIntro') + '\n1:30 ' + t('chapterExampleMain')}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
        />
        {!chaptersText.trim() && chaptersFromDescription(description).length > 0 && (
          <button type="button" className="live-small-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setChaptersText(chaptersFromDescription(description).map((c) => `${formatChapterTime(c.time)} ${c.title}`).join('\n'))}>
            {t('chaptersFromDescriptionButton')}
          </button>
        )}
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p className="panel-heading" style={{ margin: 0 }}>{t('captions')}</p>
        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{t('captionsEditHint')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="live-small-btn" style={{ cursor: 'pointer' }}>
            {t('captionsImportButton')}
            <input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" style={{ display: 'none' }} onChange={(e) => importCaptionsFile(e.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="live-small-btn" onClick={generateCaptions} disabled={!videoReady || autoCaptions === 'working'}>
            {autoCaptions === 'working' ? t('captionsGenerating') : t('captionsGenerateButton')}
          </button>
          {captionsText.trim() && (
            <button type="button" className="live-small-btn live-danger" onClick={() => setCaptionsText('')}>
              {t('captionsClearButton')}
            </button>
          )}
        </div>
        {autoCaptions === 'unsupported' && <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{t('captionsUnsupportedLanguage')}</p>}
        {autoCaptions === 'error' && <p className="error-text" style={{ margin: 0 }}>{t('captionsGenerateFailed')}</p>}
        <textarea
          value={captionsText}
          onChange={(e) => setCaptionsText(e.target.value)}
          rows={8}
          placeholder={'1\n00:00:01,000 --> 00:00:03,500\n' + t('captionTextPlaceholder')}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }}
        />
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
