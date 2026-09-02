'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import FieldHint from '@/components/FieldHint';
import { useLanguage } from '@/lib/i18n';
import { CATEGORY_KEYS } from '@/lib/categories';
import { uploadResumable } from '@/lib/tusUpload';

const LANGUAGE_OPTIONS = [
  { code: 'cs', key: 'langOptCzech' },
  { code: 'sk', key: 'langOptSlovak' },
  { code: 'en', key: 'langOptEnglish' },
  { code: 'de', key: 'langOptGerman' },
  { code: 'es', key: 'langOptSpanish' },
  { code: 'pl', key: 'langOptPolish' },
  { code: 'fr', key: 'langOptFrench' },
  { code: 'uk', key: 'langOptUkrainian' },
  { code: 'other', key: 'langOptOther' },
] as const;

type Visibility = 'public' | 'subscribers' | 'private';
type ScheduleMode = 'now' | 'scheduled' | 'premiere';

// Na jednom videu se můžou podílet nejvýš 4 tvůrci - ten, kdo ho nahrál,
// a k tomu ještě tři spolutvůrci. Všichni čtyři se pak ukazují pod videem.
const MAX_VIDEO_CREATORS = 4;
const MAX_COLLABORATORS = MAX_VIDEO_CREATORS - 1;

export default function UploadPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  // Krok 1 - obsah videa
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [videoWidth, setVideoWidth] = useState<number | null>(null);
  const [videoHeight, setVideoHeight] = useState<number | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hashtagsInput, setHashtagsInput] = useState('');
  const [madeForKids, setMadeForKids] = useState(false);
  const [hasPaidPromotion, setHasPaidPromotion] = useState(false);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [language, setLanguage] = useState('cs');
  const [category, setCategory] = useState('');
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedCollaborators, setSelectedCollaborators] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [collabSearch, setCollabSearch] = useState('');
  const [collabResults, setCollabResults] = useState<{ id: string; username: string; avatar_url: string | null }[]>([]);
  const [collabError, setCollabError] = useState<string | null>(null);
  // Video se nahrálo, ale některé pozvánky ke spolupráci neprošly - tady si
  // appka drží koho a ke kterému videu, ať to jde dokončit v úpravách.
  const [failedInvites, setFailedInvites] = useState<{ videoId: string; names: string[] } | null>(null);

  async function searchCollaborators(query: string) {
    setCollabSearch(query);
    setCollabError(null);
    if (query.trim().length < 2) {
      setCollabResults([]);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${query.trim()}%`)
      .limit(6);
    setCollabResults((data ?? []).filter((p: any) => !selectedCollaborators.some((c) => c.id === p.id)));
  }

  async function addCollaborator(profile: { id: string; username: string; avatar_url: string | null }) {
    setCollabError(null);
    if (!userId) return;

    // Na jednom videu se můžou podílet nejvýš 4 lidi - ty a další tři.
    if (selectedCollaborators.length >= MAX_COLLABORATORS) {
      setCollabError(t('collabLimitReachedNote').replace('{max}', String(MAX_VIDEO_CREATORS)));
      return;
    }

    if (profile.id === userId) {
      setCollabError(t('collabCannotAddYourselfNote'));
      return;
    }

    // Spolupráci jde nabídnout jen tomu, koho vzájemně odebíráte - ať appku
    // někdo nemůže takhle spamovat cizí lidi.
    const { data: mutualCheck } = await supabase
      .from('subscriptions')
      .select('subscriber_id, channel_id')
      .or(`and(subscriber_id.eq.${userId},channel_id.eq.${profile.id}),and(subscriber_id.eq.${profile.id},channel_id.eq.${userId})`);

    const iSubscribeToThem = (mutualCheck ?? []).some((s) => s.subscriber_id === userId && s.channel_id === profile.id);
    const theySubscribeToMe = (mutualCheck ?? []).some((s) => s.subscriber_id === profile.id && s.channel_id === userId);

    if (!iSubscribeToThem || !theySubscribeToMe) {
      setCollabError(t('mutualSubscriptionRequiredNote'));
      return;
    }

    setSelectedCollaborators((prev) => [...prev, profile]);
    setCollabSearch('');
    setCollabResults([]);
  }

  function removeCollaborator(profileId: string) {
    setSelectedCollaborators((prev) => prev.filter((c) => c.id !== profileId));
  }
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [chapters, setChapters] = useState<{ time: string; title: string }[]>([{ time: '0:00', title: '' }]);
  const [captions, setCaptions] = useState<{ time: string; text: string }[]>([{ time: '0:00', text: '' }]);

  // Krok 2 - viditelnost a plánování
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('now');
  const [scheduledAt, setScheduledAt] = useState('');

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'saving' | 'processing' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setIsLoggedIn(!!data.user);
      setUserId(data.user?.id ?? null);
      setCheckingAuth(false);
      if (data.user) {
        const { data: pl } = await supabase.from('playlists').select('id, title').eq('owner_id', data.user.id);
        setPlaylists(pl ?? []);
      }
    });
  }, []);

  function togglePlaylist(id: string) {
    setSelectedPlaylists((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  function goToStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) {
      setError('Vyber video a vyplň alespoň název.');
      return;
    }
    setError(null);
    setStep(2);
  }

  async function handleFinalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setStatus('uploading');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const urlRes = await fetch('/api/videos/create-upload-url', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
          'Content-Type': 'application/json',
        },
        // Podle velikosti se rozhodne, jestli stačí jeden požadavek, nebo
        // se musí nahrávat po částech - Cloudflare jedním požadavkem
        // přijme nejvýš 200 MB.
        body: JSON.stringify({ fileSize: file.size }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Nepodařilo se připravit upload.');

      if (urlData.mode === 'tus') {
        await uploadResumable({ url: urlData.uploadURL, file, onProgress: setProgress });
      } else {
        await uploadWithProgress(urlData.uploadURL, file, setProgress);
      }

      setStatus('saving');

      const finalScheduledAt =
        scheduleMode === 'now' ? null : scheduledAt ? new Date(scheduledAt).toISOString() : null;

      const confirmRes = await fetch('/api/videos/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionData.session?.access_token}`,
        },
        body: JSON.stringify({
          title,
          description,
          cloudflareVideoId: urlData.videoId,
          madeForKids,
          hasPaidPromotion,
          isAiGenerated,
          language,
          category,
          visibility: selectedCollaborators.length > 0 ? 'private' : visibility,
          isPremiere: scheduleMode === 'premiere',
          scheduledAt: finalScheduledAt,
          width: videoWidth,
          height: videoHeight,
          chapters: chapters
            .filter((c) => c.title.trim())
            .map((c) => ({ time: parseTimeToSeconds(c.time), title: c.title.trim() }))
            .filter((c) => c.time !== null),
          captions: captions
            .filter((c) => c.text.trim())
            .map((c) => ({ time: parseTimeToSeconds(c.time), text: c.text.trim() }))
            .filter((c) => c.time !== null),
          hashtags: hashtagsInput
            .split(/[\s,]+/)
            .map((h) => h.trim().replace(/^#/, '').toLowerCase())
            .filter((h) => h.length > 0),
        }),
      });

      if (!confirmRes.ok) {
        const confirmData = await confirmRes.json();
        throw new Error(confirmData.error || 'Nepodařilo se uložit video.');
      }

      const confirmData = await confirmRes.json();
      const newVideoId = confirmData.video.id;

      if (thumbnailFile) {
        const { data: sessionForThumb } = await supabase.auth.getSession();
        const userId = sessionForThumb.session?.user.id;
        if (userId) {
          const ext = thumbnailFile.name.split('.').pop();
          const path = `${userId}/${newVideoId}.${ext}`;
          const { error: thumbError } = await supabase.storage.from('thumbnails').upload(path, thumbnailFile, { upsert: true });
          if (!thumbError) {
            const { data: publicUrlData } = supabase.storage.from('thumbnails').getPublicUrl(path);
            await supabase
              .from('videos')
              .update({ thumbnail_url: `${publicUrlData.publicUrl}?t=${Date.now()}`, custom_thumbnail: true })
              .eq('id', newVideoId);
          }
        }
      }

      if (selectedPlaylists.length > 0) {
        await Promise.all(
          selectedPlaylists.map((playlistId) =>
            supabase.from('playlist_videos').upsert({ playlist_id: playlistId, video_id: newVideoId })
          )
        );
      }

      if (selectedCollaborators.length > 0) {
        await supabase.from('videos').update({ pending_collab_visibility: visibility }).eq('id', newVideoId);

        // Chyby při zvaní se dřív potichu ztratily - tvůrci to vypadalo,
        // že spolupráce prostě "nefunguje". Teď se sebere a ukáže.
        const failed: string[] = [];
        setFailedInvites(null);

        await Promise.all(
          selectedCollaborators.slice(0, MAX_COLLABORATORS).map(async (c) => {
            const { error: collabError } = await supabase
              .from('video_collaborators')
              .insert({ video_id: newVideoId, profile_id: c.id, status: 'pending' });

            if (collabError) {
              failed.push(c.username);
              return;
            }

            const { error: notifyError } = await supabase.from('notifications').insert({
              user_id: c.id,
              type: 'collab_invite',
              message: t('collabInviteMessage').replace('{title}', title),
              link: `/watch/${newVideoId}`,
            });

            if (notifyError) failed.push(c.username);
          })
        );

        // Video je nahrané, ale někoho se nepodařilo pozvat. Uživatele proto
        // neposíláme pryč - dřív se hláška nastavila a hned vzápětí zmizela
        // s přesměrováním na hlavní stránku, takže spolupráce tiše propadla.
        if (failed.length > 0) {
          setStatus('processing');
          await waitUntilReady(newVideoId);
          setStatus('idle');
          setFailedInvites({ videoId: newVideoId, names: failed });
          return;
        }
      }

      setStatus('processing');
      const ready = await waitUntilReady(newVideoId);

      if (!ready) {
        // Video se nahrálo, jen se zpracovává dýl. Patří tvůrci a najde ho
        // ve Tvých videích - jen tam bude chvíli psát "Zpracovává se".
        setStatus('done');
        router.push('/your-videos');
        return;
      }

      setStatus('done');
      router.push('/');
    } catch (err: any) {
      setError(err.message);
      setStatus('idle');
    }
  }

  /**
   * Čeká, až Cloudflare video zpracuje.
   *
   * Vrací, jestli se to stihlo. Dřív se po dvou minutách jen tiše přestalo
   * čekat, appka označila nahrávání za hotové a přesměrovala na hlavní
   * stránku - jenže video ještě nebylo připravené, takže tam nebylo a
   * tvůrce si myslel, že se nahrávání ztratilo.
   */
  async function waitUntilReady(videoId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await fetch('/api/videos/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (data.status === 'ready') return true;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return false;
  }

  if (checkingAuth) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!isLoggedIn) {
    return (
      <div className="auth-gate">
        <p>{t('loginToUploadNote')}</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  if (step === 1) {
    return (
      <form className="form-container" style={{ maxWidth: 560 }} onSubmit={goToStep2}>
        <h1>{t('uploadVideo')}</h1>

        <div className="panel">
          <p className="panel-heading">
            {t('videoFile')}
            <FieldHint text={t('selectVideoFileHint')} />
          </p>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreviewUrl(f ? URL.createObjectURL(f) : null);
            }}
            required={!file}
          />
          {file && (
            <p style={{ fontSize: 12, color: 'var(--brand)', marginTop: 6 }}>
              ✓ {file.name}
            </p>
          )}

          {previewUrl && (
            <video
              src={previewUrl}
              controls
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                setVideoWidth(v.videoWidth);
                setVideoHeight(v.videoHeight);
              }}
              style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 260, marginTop: 12 }}
            />
          )}
        </div>

        <div className="panel">
          <p className="panel-heading">
            {t('customThumbnail')}
            <FieldHint text={t('optionalThumbnailHint')} />
          </p>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (!f) { setThumbnailFile(null); return; }

              const img = new window.Image();
              img.onload = () => {
                const imageRatio = img.width / img.height;
                const videoRatio = videoWidth && videoHeight ? videoWidth / videoHeight : 16 / 9;
                const diff = Math.abs(imageRatio - videoRatio) / videoRatio;

                if (diff > 0.15) {
                  const ok = confirm(t('aspectRatioMismatchWarning'));
                  if (!ok) {
                    e.target.value = '';
                    setThumbnailFile(null);
                    return;
                  }
                }
                setThumbnailFile(f);
              };
              img.src = URL.createObjectURL(f);
            }}
          />
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="panel-heading" style={{ marginBottom: -4 }}>{t('basicInfo')}</p>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('videoTitle')}
              <FieldHint text={t('titleFieldHint')} />
            </label>
            <input type="text" placeholder={t('videoTitle')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('description2')}
              <FieldHint text={t('descriptionFieldHint')} />
            </label>
            <textarea placeholder={t('optionalDescription')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            <input
              type="text"
              placeholder={t('hashtagsPlaceholderExample')}
              value={hashtagsInput}
              onChange={(e) => setHashtagsInput(e.target.value)}
              style={{ marginTop: 10 }}
            />
          </div>
        </div>

        {playlists.length > 0 && (
          <div className="panel" style={{ position: 'relative' }}>
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('playlists')}
              <FieldHint text={t('playlistsFieldHint')} />
            </label>
            <button
              type="button"
              onClick={() => setPlaylistMenuOpen((v) => !v)}
              style={{ background: 'var(--panel-raised)', color: 'var(--text)', width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>
                {selectedPlaylists.length === 0
                  ? t('addToPlaylistPlaceholder')
                  : `${t('selectedCountLabel')} ${selectedPlaylists.length}`}
              </span>
              <span>{playlistMenuOpen ? '▲' : '▼'}</span>
            </button>
            {playlistMenuOpen && (
              <div className="profile-dropdown" style={{ position: 'static', width: '100%', marginTop: 6, boxShadow: 'none' }}>
                {playlists.map((p) => (
                  <label key={p.id} className="profile-dropdown-item" style={{ cursor: 'pointer' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={selectedPlaylists.includes(p.id)}
                        onChange={() => togglePlaylist(p.id)}
                      />
                      {p.title}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="panel">
          <p className="panel-heading">
            {t('collaboratorsLabel')}
            <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 12, marginLeft: 8 }}>
              {selectedCollaborators.length + 1}/{MAX_VIDEO_CREATORS}
            </span>
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 10 }}>{t('collaboratorsHint')}</p>

          {selectedCollaborators.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              {selectedCollaborators.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="profile-avatar-small" style={{ width: 26, height: 26, overflow: 'hidden' }}>
                    {c.avatar_url ? <img src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </span>
                  <span style={{ fontSize: 13, flex: 1 }}>{c.username}</span>
                  <button type="button" onClick={() => removeCollaborator(c.id)} style={{ background: 'none', color: 'var(--text-faint)', padding: 4, fontSize: 12 }}>
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
            disabled={selectedCollaborators.length >= MAX_COLLABORATORS}
          />
          {selectedCollaborators.length >= MAX_COLLABORATORS && (
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
                  onClick={() => addCollaborator(r)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel-raised)',
                    border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', textAlign: 'left',
                  }}
                >
                  <span className="profile-avatar-small" style={{ width: 22, height: 22, overflow: 'hidden', flexShrink: 0 }}>
                    {r.avatar_url ? <img src={r.avatar_url} alt={r.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{r.username}</span>
                </button>
              ))}
            </div>
          )}
          {collabError && <p className="error-text" style={{ marginTop: 8 }}>{collabError}</p>}
        </div>

        <div className="panel">
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {t('chapters')}
            <FieldHint text={t('chaptersFieldHint')} />
          </label>
          {chapters.map((ch, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                type="text"
                placeholder="mm:ss"
                value={ch.time}
                onChange={(e) => {
                  const next = [...chapters];
                  next[i] = { ...next[i], time: e.target.value };
                  setChapters(next);
                }}
                style={{ width: 70 }}
              />
              <input
                type="text"
                placeholder={t('chapterTitlePlaceholder')}
                value={ch.title}
                onChange={(e) => {
                  const next = [...chapters];
                  next[i] = { ...next[i], title: e.target.value };
                  setChapters(next);
                }}
                style={{ flex: 1 }}
              />
              {chapters.length > 1 && (
                <button
                  type="button"
                  onClick={() => setChapters(chapters.filter((_, idx) => idx !== i))}
                  style={{ background: 'var(--panel-raised)', color: 'var(--text-faint)', padding: '0 10px' }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setChapters([...chapters, { time: '', title: '' }])}
            style={{ marginTop: 8, background: 'var(--panel-raised)', color: 'var(--text)', fontSize: 12 }}
          >
            {t('addChapter')}
          </button>
        </div>

        <div className="panel">
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {t('captions')}
            <FieldHint text={t('overlaysFieldHint')} />
          </label>
          {captions.map((cap, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                type="text"
                placeholder="mm:ss"
                value={cap.time}
                onChange={(e) => {
                  const next = [...captions];
                  next[i] = { ...next[i], time: e.target.value };
                  setCaptions(next);
                }}
                style={{ width: 70 }}
              />
              <input
                type="text"
                placeholder={t('captionTextPlaceholder')}
                value={cap.text}
                onChange={(e) => {
                  const next = [...captions];
                  next[i] = { ...next[i], text: e.target.value };
                  setCaptions(next);
                }}
                style={{ flex: 1 }}
              />
              {captions.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCaptions(captions.filter((_, idx) => idx !== i))}
                  style={{ background: 'var(--panel-raised)', color: 'var(--text-faint)', padding: '0 10px' }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setCaptions([...captions, { time: '', text: '' }])}
            style={{ marginTop: 8, background: 'var(--panel-raised)', color: 'var(--text)', fontSize: 12 }}
          >
            {t('addCaption')}
          </button>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} />
            {t('madeForKidsLabel')}
            <FieldHint text={t('madeForKidsHint')} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={hasPaidPromotion} onChange={(e) => setHasPaidPromotion(e.target.checked)} />
            {t('paidPromoLabel')}
            <FieldHint text={t('paidPromoHint')} />
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={isAiGenerated} onChange={(e) => setIsAiGenerated(e.target.checked)} />
            {t('aiContentLabel')}
            <FieldHint text={t('aiContentHint')} />
          </label>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('videoLanguageLabel')}
              <FieldHint text={t('videoLanguageHint')} />
            </label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{t(l.key)}</option>)}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('categoryLabel')}
              <FieldHint text={t('categoryHint')} />
            </label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="" disabled>{t('selectCategoryPlaceholder')}</option>
              {CATEGORY_KEYS.map((c) => <option key={c} value={c}>{t(c)}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        <button type="submit">{t('continueButton')}</button>
      </form>
    );
  }

  return (
    <form className="form-container" style={{ maxWidth: 480 }} onSubmit={handleFinalSubmit}>
      <h1>{t('visibilityAndSchedulingHeading')}</h1>

      <div className="panel">
        <p className="panel-heading">
          {t('whoCanSeeVideo')}
          <FieldHint text={t('visibilityExplanationHint')} />
        </p>
        {([
          ['public', t('visibilityPublic')],
          ['subscribers', t('visibilitySubscribers')],
          ['private', t('visibilityPrivate')],
        ] as [Visibility, string][]).map(([value, label]) => (
          <label key={value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input type="radio" name="visibility" style={{ width: 'auto' }} checked={visibility === value} onChange={() => setVisibility(value)} />
            {label}
          </label>
        ))}
      </div>

      <div className="panel">
        <p className="panel-heading">
          {t('publishingSectionLabel')}
          <FieldHint text={t('premiereVsScheduledHint')} />
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
          <input type="radio" name="schedule" style={{ width: 'auto' }} checked={scheduleMode === 'now'} onChange={() => setScheduleMode('now')} />
          {t('publishNow')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
          <input type="radio" name="schedule" style={{ width: 'auto' }} checked={scheduleMode === 'scheduled'} onChange={() => setScheduleMode('scheduled')} />
          {t('scheduleOption')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
          <input type="radio" name="schedule" style={{ width: 'auto' }} checked={scheduleMode === 'premiere'} onChange={() => setScheduleMode('premiere')} />
          {t('premiereOption')}
        </label>

        {scheduleMode !== 'now' && (
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required />
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* Video je nahrané, ale někoho se nepodařilo pozvat ke spolupráci.
          Zůstáváme na stránce a nabídneme rovnou úpravy videa, ať to jde
          dotáhnout - dřív hláška zmizela dřív, než ji šlo přečíst. */}
      {failedInvites && (
        <div className="panel" style={{ borderColor: '#e0453f' }}>
          <p className="error-text" style={{ margin: 0 }}>
            {t('collabInviteFailedNote').replace('{names}', failedInvites.names.join(', '))}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Link href={`/your-videos/${failedInvites.videoId}/edit`} className="reaction-btn">
              {t('collaboratorsLabel')}
            </Link>
            <button type="button" onClick={() => { setFailedInvites(null); router.push('/'); }} style={{ background: 'var(--panel-raised)', color: 'var(--text)' }}>
              {t('home')}
            </button>
          </div>
        </div>
      )}

      {status === 'uploading' && <p>{t('uploading')} {progress}%</p>}
      {status === 'saving' && <p>{t('savingVideoLabel')}</p>}
      {status === 'processing' && <p>{t('processingVideoNote')}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setStep(1)} style={{ background: 'var(--panel-raised)', color: 'var(--text)' }}>
          {t('backButton')}
        </button>
        {/* Když už je video nahrané (jen se nepovedly pozvánky), nesmí jít
            odeslat formulář znovu - jinak by se nahrálo podruhé. */}
        <button type="submit" disabled={status !== 'idle' || !!failedInvites} style={{ flex: 1 }}>
          {status === 'idle' ? t('uploadButton') : t('processing')}
        </button>
      </div>
    </form>
  );
}

function parseTimeToSeconds(value: string): number | null {
  if (!value.trim()) return null;
  if (value.includes(':')) {
    const [m, s] = value.split(':').map(Number);
    if (Number.isNaN(m) || Number.isNaN(s)) return null;
    return m * 60 + s;
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function uploadWithProgress(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload do Cloudflare selhal (kód ${xhr.status}): ${xhr.responseText || 'bez dalších detailů'}`));
    };
    // Prohlížeč tady nedokáže rozlišit vypadlé připojení od odmítnutí
    // druhou stranou: odmítnutá odpověď z cizí domény se k nám nedostane
    // a XHR ohlásí obojí stejně. Dřív tu stálo jen "Chyba sítě při
    // nahrávání", což u velkých souborů rovnou lhalo - připojení bylo
    // v pořádku a problém byl ve velikosti.
    xhr.onerror = () =>
      reject(
        new Error(
          `Nahrávání se přerušilo. Buď vypadlo připojení, nebo soubor odmítla druhá strana ` +
            `(velikost ${(file.size / 1024 / 1024).toFixed(0)} MB).`
        )
      );
    xhr.send(formData);
  });
}
