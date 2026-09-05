'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import FieldHint from '@/components/FieldHint';
import { useLanguage } from '@/lib/i18n';
import { CATEGORY_KEYS } from '@/lib/categories';
import { useUploadCommands, useUploadState } from '@/lib/uploadManager';

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

  const [error, setError] = useState<string | null>(null);
  // Průběh nahrávání drží správce v kostře appky, ne tahle stránka -
  // jinak by odchod na jinou stránku nahrávání zrušil.
  const upload = useUploadState();
  const uploadCommands = useUploadCommands();
  const failedInvites = upload.failedInvites;

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

  /**
   * Odešle nahrávání ke zpracování.
   *
   * Stránka posbírá, co má tvůrce vyplněné, a předá to správci
   * v kostře appky (lib/uploadManager.tsx). Odsud dál běží nahrávání
   * nezávisle na téhle stránce, takže se dá mezitím normálně chodit po
   * appce a koukat na videa.
   *
   * Dřív celý postup bydlel tady. Jakmile tvůrce odešel jinam, Next.js
   * stránku odpojil, běžící požadavek se zrušil a nahrávání bylo pryč -
   * u dvanáctiminutového videa to znamenalo sedět čtvrt hodiny u jedné
   * stránky a nedělat nic.
   */
  function handleFinalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || upload.busy) return;
    setError(null);

    const finalScheduledAt =
      scheduleMode === 'now' ? null : scheduledAt ? new Date(scheduledAt).toISOString() : null;

    uploadCommands.start({
      file,
      thumbnailFile,
      title,
      description,
      hashtags: hashtagsInput
        .split(/[\s,]+/)
        .map((h) => h.trim().replace(/^#/, '').toLowerCase())
        .filter((h) => h.length > 0),
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
        .filter((c): c is { time: number; title: string } => c.time !== null),
      captions: captions
        .filter((c) => c.text.trim())
        .map((c) => ({ time: parseTimeToSeconds(c.time), text: c.text.trim() }))
        .filter((c): c is { time: number; text: string } => c.time !== null),
      playlistIds: selectedPlaylists,
      collaborators: selectedCollaborators.slice(0, MAX_COLLABORATORS).map((c) => ({ id: c.id, username: c.username })),
      collabInviteMessage: t('collabInviteMessage').replace('{title}', title),
    });
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
                    {c.avatar_url ? <img loading="lazy" decoding="async" src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
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
                    {r.avatar_url ? <img loading="lazy" decoding="async" src={r.avatar_url} alt={r.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
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
            <button type="button" onClick={() => { uploadCommands.dismiss(); router.push('/'); }} style={{ background: 'var(--panel-raised)', color: 'var(--text)' }}>
              {t('home')}
            </button>
          </div>
        </div>
      )}

      {upload.phase === 'uploading' && (
        <>
          <p>{t('uploading')} {upload.percent}%</p>
          <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>{t('uploadInBackgroundNote')}</p>
        </>
      )}
      {upload.phase === 'saving' && <p>{t('savingVideoLabel')}</p>}
      {upload.phase === 'processing' && <p>{t('processingVideoNote')}</p>}
      {upload.phase === 'error' && upload.error && <p className="error-text">{upload.error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setStep(1)} style={{ background: 'var(--panel-raised)', color: 'var(--text)' }}>
          {t('backButton')}
        </button>
        {/* Když už je video nahrané (jen se nepovedly pozvánky), nesmí jít
            odeslat formulář znovu - jinak by se nahrálo podruhé. */}
        {/* Dokud nahrávání běží, nesmí jít odeslat znovu - jinak by se
            video nahrálo podruhé. Totéž když už je nahrané a nepovedly se
            jen pozvánky. */}
        <button type="submit" disabled={upload.busy || upload.phase === 'done' || !!failedInvites} style={{ flex: 1 }}>
          {upload.busy || upload.phase === 'done' ? t('processing') : t('uploadButton')}
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
