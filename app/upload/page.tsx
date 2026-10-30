'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import FieldHint from '@/components/FieldHint';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { CATEGORY_KEYS } from '@/lib/categories';
import { useUploadCommands, useUploadState } from '@/lib/uploadManager';
import ProfileImage from '@/components/ProfileImage';
import UploadQuota from '@/components/UploadQuota';
import { IMAGE_MAX_BYTES, imageUploadProblem } from '@/lib/imageUpload';
import { formatDuration } from '@/lib/homeRecommendation';
import UiIcon from '@/components/UiIcon';
import { CharCount, StudioCard, StudioChecklist, StudioChoices, StudioDropzone, StudioSteps, formatFileSize, resolutionLabel } from '@/components/StudioParts';

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
  const { t, lang } = useLanguage();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  // Krok 1 - obsah videa
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Hromadné nahrání (přenos kanálu): víc souborů naráz, názvy ze souborů,
  // společné nastavení, do fronty v lib/uploadManager.tsx.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<{ file: File; title: string }[]>([]);
  const [bulkVisibility, setBulkVisibility] = useState<Visibility>('private');
  const [bulkSent, setBulkSent] = useState(0);
  const [videoWidth, setVideoWidth] = useState<number | null>(null);
  const [videoHeight, setVideoHeight] = useState<number | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  // Moc dlouhé video (podle limitů účtu - components/UploadQuota.tsx): dál to nepustí,
  // server by ho stejně odmítl až po vyplnění všeho.
  const [tooLongMessage, setTooLongMessage] = useState<string | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hashtagsInput, setHashtagsInput] = useState('');
  const [madeForKids, setMadeForKids] = useState(false);
  const [hasPaidPromotion, setHasPaidPromotion] = useState(false);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [isArtistic, setIsArtistic] = useState(false);
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

  // Vlastní náhled jako obrázek pro bok stránky (adresa se po změně uvolní).
  const thumbPreview = useMemo(() => (thumbnailFile ? URL.createObjectURL(thumbnailFile) : null), [thumbnailFile]);
  useEffect(
    () => () => {
      if (thumbPreview) URL.revokeObjectURL(thumbPreview);
    },
    [thumbPreview]
  );
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  /** Vybrané video (výběrem i přetažením): náhled, a když ještě není název, vezme se ze souboru. */
  function pickVideo(f: File | null) {
    setFile(f);
    setVideoDuration(null);
    setVideoWidth(null);
    setVideoHeight(null);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
    setError(null);
    if (f && !title.trim()) {
      setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 150));
    }
  }

  /** Vlastní náhled: typ a velikost hned (ne až po nahrání videa), jiný poměr stran jen s potvrzením. */
  function pickThumbnail(f: File | null) {
    if (!f) {
      setThumbnailFile(null);
      return;
    }
    // Úložiště pustí jen obrázky do 10 MB (lib/imageUpload.ts).
    const problem = imageUploadProblem(f, 'thumbnail');
    if (problem) {
      setError(problem === 'type' ? t('imageUploadBadType') : t('imageUploadTooBig').replace('{mb}', String(IMAGE_MAX_BYTES.thumbnail / 1024 / 1024)));
      setThumbnailFile(null);
      return;
    }
    setError(null);
    const url = URL.createObjectURL(f);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const imageRatio = img.width / img.height;
      const videoRatio = videoWidth && videoHeight ? videoWidth / videoHeight : 16 / 9;
      const diff = Math.abs(imageRatio - videoRatio) / videoRatio;
      if (diff > 0.15 && !confirm(t('aspectRatioMismatchWarning'))) {
        setThumbnailFile(null);
        return;
      }
      setThumbnailFile(f);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(t('imageUploadBadType'));
    };
    img.src = url;
  }

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
      setError(t('uploadNeedFileAndTitle'));
      return;
    }
    if (tooLongMessage) {
      setError(tooLongMessage);
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
  function pickBulkFiles(list: FileList | File[] | null) {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name));
    setBulkFiles(
      files.map((f) => ({
        file: f,
        // Název ze souboru: bez přípony, podtržítka a pomlčky na mezery.
        title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 150) || f.name,
      }))
    );
  }

  /**
   * Hromadné nahrání: každý soubor je jedna úloha se společným nastavením.
   * Výchozí viditelnost je soukromé - tvůrce si názvy a popisy doladí
   * v klidu v Moje videa a zveřejní, až bude chtít. Upload běží na pozadí
   * jeden po druhém (lib/uploadManager.tsx).
   */
  function handleBulkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (bulkFiles.length === 0) {
      setError(t('bulkNoFiles'));
      return;
    }
    if (!category) {
      setError(t('selectCategoryPlaceholder'));
      return;
    }
    setError(null);
    uploadCommands.startMany(
      bulkFiles.map(({ file: f, title: name }) => ({
        file: f,
        thumbnailFile: null,
        title: name.trim() || f.name,
        description: '',
        hashtags: parseHashtags(hashtagsInput),
        madeForKids,
        hasPaidPromotion: false,
        isAiGenerated,
        language,
        category,
        visibility: bulkVisibility,
        isPremiere: false,
        scheduledAt: null,
        width: null,
        height: null,
        chapters: [],
        captions: [],
        playlistIds: selectedPlaylists,
        collaborators: [],
        collabInviteMessage: '',
      }))
    );
    setBulkSent(bulkFiles.length);
    setBulkFiles([]);
  }

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
      hashtags: parseHashtags(hashtagsInput),
      madeForKids,
      hasPaidPromotion,
      isAiGenerated,
      isArtistic,
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

  // Náhled videa a vlastního náhledu - v boku stránky v obou krocích.
  const tags = parseHashtags(hashtagsInput);
  const preview = (
    <div className="studio-preview">
      <div className="studio-preview-media">
        {previewUrl ? (
          <video
            src={previewUrl}
            controls
            playsInline
            preload="metadata"
            poster={thumbPreview ?? undefined}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setVideoWidth(v.videoWidth);
              setVideoHeight(v.videoHeight);
              setVideoDuration(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
            }}
          />
        ) : thumbPreview ? (
          <img src={thumbPreview} alt="" />
        ) : (
          <span className="studio-preview-empty" aria-hidden="true">
            <UiIcon name="film" size={30} />
          </span>
        )}
        {videoDuration ? <span className="studio-preview-duration">{formatDuration(videoDuration)}</span> : null}
      </div>
      <p className={`studio-preview-title${title.trim() ? '' : ' empty'}`}>{title.trim() || t('studioTitlePlaceholder')}</p>
      {(category || tags.length > 0) && (
        <p className="studio-preview-meta">
          {[category ? t(category as (typeof CATEGORY_KEYS)[number]) : null, ...tags.slice(0, 3).map((h) => `#${h}`)].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );

  if (step === 1 && bulkMode) {
    return (
      <form className="studio studio-narrow" onSubmit={handleBulkSubmit}>
        <header className="studio-head">
          <div className="studio-head-text">
            <h1>
              {t('bulkUploadTitle')}
              <FieldHint text={t('bulkUploadIntro')} />
            </h1>
          </div>
          <button type="button" className="studio-ghost-btn" onClick={() => { setBulkMode(false); setError(null); }}>
            <UiIcon name="chevronLeft" size={15} /> {t('bulkBackToSingle')}
          </button>
        </header>

        {bulkSent > 0 && (
          <div className="studio-card studio-success">
            <p style={{ margin: 0, color: 'var(--text)', fontWeight: 600 }}>{t('bulkStarted').replace('{count}', String(bulkSent))}</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{t('bulkStartedNote')}</p>
            <Link href="/your-videos" className="studio-ghost-btn" style={{ marginTop: 12 }}>
              {t('yourVideos')}
            </Link>
          </div>
        )}

        <StudioCard icon="upload" title={t('bulkFilesLabel')} hint={t('bulkFilesHint')}>
          <StudioDropzone
            accept="video/*"
            multiple
            icon="upload"
            title={t('studioDropVideos')}
            hint={t('studioDropVideoHint')}
            button={t('studioPickFile')}
            onFiles={(fs) => pickBulkFiles(fs)}
          />
          <UploadQuota />
          {bulkFiles.length > 0 && (
            <div className="studio-bulk-list">
              {bulkFiles.map((item, i) => (
                <div key={`${item.file.name}-${i}`} className="studio-bulk-row">
                  <UiIcon name="film" size={16} />
                  <input
                    value={item.title}
                    onChange={(e) => setBulkFiles((prev) => prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                    aria-label={t('videoTitle')}
                    maxLength={150}
                  />
                  <span className="studio-bulk-size">{formatFileSize(item.file.size)}</span>
                  <button type="button" className="icon-btn" onClick={() => setBulkFiles((prev) => prev.filter((_, j) => j !== i))} aria-label={t('delete')}>
                    <UiIcon name="close" size={14} />
                  </button>
                </div>
              ))}
              <p className="studio-note">{t('bulkCount').replace('{count}', String(bulkFiles.length))}</p>
            </div>
          )}
        </StudioCard>

        <StudioCard icon="sliders" title={t('bulkSharedSettings')}>
          <div className="studio-row2">
            <div className="studio-field">
              <label htmlFor="bulk-cat">{t('categoryLabel')}</label>
              <select id="bulk-cat" value={category} onChange={(e) => setCategory(e.target.value)} required>
                <option value="" disabled>{t('selectCategoryPlaceholder')}</option>
                {CATEGORY_KEYS.map((c) => <option key={c} value={c}>{t(c)}</option>)}
              </select>
            </div>
            <div className="studio-field">
              <label htmlFor="bulk-lang">{t('videoLanguageLabel')}</label>
              <select id="bulk-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{t(l.key)}</option>)}
              </select>
            </div>
          </div>
          <div className="studio-field">
            <label>{t('whoCanSeeVideo')}</label>
            <StudioChoices
              name="bulkVisibility"
              value={bulkVisibility}
              onChange={setBulkVisibility}
              options={[
                { value: 'private', icon: 'lock', title: t('studioVisPrivate'), desc: t('studioVisPrivateDesc') },
                { value: 'subscribers', icon: 'users', title: t('studioVisSubscribers'), desc: t('studioVisSubscribersDesc') },
                { value: 'public', icon: 'globe', title: t('studioVisPublic'), desc: t('studioVisPublicDesc') },
              ]}
            />
            <p className="studio-note">{t('bulkVisibilityNote')}</p>
          </div>
          <div className="studio-field">
            <label htmlFor="bulk-tags">{t('studioHashtags')}</label>
            <input id="bulk-tags" value={hashtagsInput} onChange={(e) => setHashtagsInput(e.target.value)} placeholder={t('hashtagsPlaceholderExample')} />
          </div>
          <div className="studio-flags">
            <label className="studio-flag">
              <input type="checkbox" checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} />
              <span>{t('madeForKidsLabel')}</span>
            </label>
            <label className="studio-flag">
              <input type="checkbox" checked={isAiGenerated} onChange={(e) => setIsAiGenerated(e.target.checked)} />
              <span>{t('aiContentLabel')}</span>
            </label>
          </div>
          {playlists.length > 0 && (
            <div className="studio-field">
              <label>{t('playlists')}</label>
              <div className="studio-chips">
                {playlists.map((p) => (
                  <button key={p.id} type="button" className={`studio-chip${selectedPlaylists.includes(p.id) ? ' active' : ''}`} aria-pressed={selectedPlaylists.includes(p.id)} onClick={() => togglePlaylist(p.id)}>
                    {selectedPlaylists.includes(p.id) && <UiIcon name="check" size={13} />}
                    {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </StudioCard>

        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="studio-primary" disabled={bulkFiles.length === 0}>
          <UiIcon name="upload" size={16} />
          {t('bulkUploadButton').replace('{count}', String(bulkFiles.length))}
        </button>
      </form>
    );
  }

  if (step === 1) {
    return (
      <form className="studio" onSubmit={goToStep2}>
        <header className="studio-head">
          <div className="studio-head-text">
            <h1>{t('uploadVideo')}</h1>
            <StudioSteps steps={[t('studioStepDetails'), t('studioStepPublish')]} current={0} />
          </div>
          <button type="button" className="studio-ghost-btn" onClick={() => { setBulkMode(true); setError(null); }}>
            <UiIcon name="folder" size={15} /> {t('bulkSwitch')}
          </button>
        </header>

        <div className="studio-grid">
          <div className="studio-main">
            <StudioCard icon="film" title={t('videoFile')} hint={t('selectVideoFileHint')}>
              {!file ? (
                <StudioDropzone
                  accept="video/*"
                  icon="upload"
                  title={t('studioDropVideo')}
                  hint={t('studioDropVideoHint')}
                  button={t('studioPickFile')}
                  onFiles={(fs) => pickVideo(fs[0] ?? null)}
                />
              ) : (
                <div className="studio-file">
                  <span className="studio-file-icon" aria-hidden="true">
                    <UiIcon name="check" size={18} />
                  </span>
                  <span className="studio-file-text">
                    <span className="studio-file-name">{file.name}</span>
                    <span className="studio-file-meta">
                      {[formatFileSize(file.size), videoDuration ? formatDuration(videoDuration) : null, resolutionLabel(videoWidth, videoHeight)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <label className="studio-ghost-btn">
                    <input
                      type="file"
                      accept="video/*"
                      className="studio-drop-input"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) pickVideo(f);
                        e.target.value = '';
                      }}
                    />
                    {t('studioChangeFile')}
                  </label>
                </div>
              )}
              <UploadQuota durationSeconds={file ? videoDuration : null} onTooLong={setTooLongMessage} />
            </StudioCard>

            <StudioCard icon="pencil" title={t('basicInfo')}>
              <div className="studio-field">
                <label htmlFor="up-title">
                  {t('videoTitle')}
                  <FieldHint text={t('titleFieldHint')} />
                </label>
                <input id="up-title" type="text" placeholder={t('studioTitlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
                <CharCount value={title} max={150} />
              </div>
              <div className="studio-field">
                <label htmlFor="up-desc">
                  {t('description2')}
                  <FieldHint text={t('descriptionFieldHint')} />
                </label>
                <textarea id="up-desc" placeholder={t('optionalDescription')} value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={5000} />
                <CharCount value={description} max={5000} />
              </div>
              <div className="studio-field">
                <label htmlFor="up-tags">{t('studioHashtags')}</label>
                <input id="up-tags" type="text" placeholder={t('hashtagsPlaceholderExample')} value={hashtagsInput} onChange={(e) => setHashtagsInput(e.target.value)} />
                {tags.length > 0 && (
                  <div className="studio-tags">
                    {tags.slice(0, 15).map((h) => (
                      <span key={h}>#{h}</span>
                    ))}
                  </div>
                )}
              </div>
            </StudioCard>

            <StudioCard icon="image" title={t('customThumbnail')} hint={t('optionalThumbnailHint')}>
              {thumbPreview ? (
                <div className="studio-thumb">
                  <img src={thumbPreview} alt="" />
                  <div className="studio-thumb-actions">
                    <label className="studio-ghost-btn">
                      <input
                        type="file"
                        accept="image/*"
                        className="studio-drop-input"
                        onChange={(e) => {
                          pickThumbnail(e.target.files?.[0] ?? null);
                          e.target.value = '';
                        }}
                      />
                      {t('studioChangeFile')}
                    </label>
                    <button type="button" className="studio-ghost-btn" onClick={() => setThumbnailFile(null)}>
                      {t('studioRemove')}
                    </button>
                  </div>
                </div>
              ) : (
                <StudioDropzone
                  compact
                  accept="image/*"
                  icon="image"
                  title={t('studioDropThumb')}
                  hint={t('studioThumbAuto')}
                  button={t('studioPickImage')}
                  onFiles={(fs) => pickThumbnail(fs[0] ?? null)}
                />
              )}
            </StudioCard>

            <StudioCard icon="grid" title={t('studioCategoryLanguage')}>
              <div className="studio-row2">
                <div className="studio-field">
                  <label htmlFor="up-cat">
                    {t('categoryLabel')}
                    <FieldHint text={t('categoryHint')} />
                  </label>
                  <select id="up-cat" value={category} onChange={(e) => setCategory(e.target.value)} required>
                    <option value="" disabled>{t('selectCategoryPlaceholder')}</option>
                    {CATEGORY_KEYS.map((c) => <option key={c} value={c}>{t(c)}</option>)}
                  </select>
                </div>
                <div className="studio-field">
                  <label htmlFor="up-lang">
                    {t('videoLanguageLabel')}
                    <FieldHint text={t('videoLanguageHint')} />
                  </label>
                  <select id="up-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {LANGUAGE_OPTIONS.map((l) => <option key={l.code} value={l.code}>{t(l.key)}</option>)}
                  </select>
                </div>
              </div>
            </StudioCard>

            {playlists.length > 0 && (
              <StudioCard icon="folder" title={t('playlists')} hint={t('playlistsFieldHint')}>
                <div className="studio-chips">
                  {playlists.map((p) => (
                    <button key={p.id} type="button" className={`studio-chip${selectedPlaylists.includes(p.id) ? ' active' : ''}`} aria-pressed={selectedPlaylists.includes(p.id)} onClick={() => togglePlaylist(p.id)}>
                      {selectedPlaylists.includes(p.id) && <UiIcon name="check" size={13} />}
                      {p.title}
                    </button>
                  ))}
                </div>
              </StudioCard>
            )}

            <details className="studio-more">
              <summary>
                <span className="studio-card-icon" aria-hidden="true">
                  <UiIcon name="sliders" size={17} />
                </span>
                <span className="studio-more-text">
                  <span className="studio-more-title">{t('studioMoreOptions')}</span>
                  <span className="studio-more-hint">{t('studioMoreOptionsHint')}</span>
                </span>
                <UiIcon name="chevronDown" size={18} className="studio-more-chevron" />
              </summary>
              <div className="studio-more-body">
                <div className="studio-sub">
                  <p className="studio-sub-title">
                    <UiIcon name="users" size={15} />
                    {t('collaboratorsLabel')}
                    <span className="studio-sub-count">
                      {selectedCollaborators.length + 1}/{MAX_VIDEO_CREATORS}
                    </span>
                  </p>
                  <p className="studio-note">{t('collaboratorsHint')}</p>
                  {selectedCollaborators.length > 0 && (
                    <div className="studio-people">
                      {selectedCollaborators.map((c) => (
                        <span key={c.id} className="studio-person">
                          <span className="studio-person-avatar">
                            {c.avatar_url ? <ProfileImage src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                          </span>
                          {c.username}
                          <button type="button" className="icon-btn" onClick={() => removeCollaborator(c.id)} aria-label={t('studioRemove')}>
                            <UiIcon name="close" size={12} />
                          </button>
                        </span>
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
                    <p className="studio-note">{t('collabLimitReachedNote').replace('{max}', String(MAX_VIDEO_CREATORS))}</p>
                  )}
                  {collabResults.length > 0 && (
                    <div className="studio-results">
                      {collabResults.map((r) => (
                        <button key={r.id} type="button" className="studio-result" onClick={() => addCollaborator(r)}>
                          <span className="studio-person-avatar">
                            {r.avatar_url ? <ProfileImage src={r.avatar_url} alt={r.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                          </span>
                          {r.username}
                        </button>
                      ))}
                    </div>
                  )}
                  {collabError && <p className="error-text" style={{ margin: 0 }}>{collabError}</p>}
                </div>

                <div className="studio-sub">
                  <p className="studio-sub-title">
                    <UiIcon name="sort" size={15} />
                    {t('chapters')}
                    <FieldHint text={t('chaptersFieldHint')} />
                  </p>
                  {chapters.map((ch, i) => (
                    <div key={i} className="studio-timed-row">
                      <input
                        type="text"
                        placeholder="mm:ss"
                        value={ch.time}
                        onChange={(e) => {
                          const next = [...chapters];
                          next[i] = { ...next[i], time: e.target.value };
                          setChapters(next);
                        }}
                        className="studio-time"
                        aria-label="mm:ss"
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
                      />
                      {chapters.length > 1 && (
                        <button type="button" className="icon-btn" onClick={() => setChapters(chapters.filter((_, idx) => idx !== i))} aria-label={t('studioRemove')}>
                          <UiIcon name="close" size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="studio-add-btn" onClick={() => setChapters([...chapters, { time: '', title: '' }])}>
                    <UiIcon name="plus" size={14} />
                    {t('addChapter').replace(/^\+\s*/, '')}
                  </button>
                </div>

                <div className="studio-sub">
                  <p className="studio-sub-title">
                    <UiIcon name="quote" size={15} />
                    {t('captions')}
                    <FieldHint text={t('overlaysFieldHint')} />
                  </p>
                  {captions.map((cap, i) => (
                    <div key={i} className="studio-timed-row">
                      <input
                        type="text"
                        placeholder="mm:ss"
                        value={cap.time}
                        onChange={(e) => {
                          const next = [...captions];
                          next[i] = { ...next[i], time: e.target.value };
                          setCaptions(next);
                        }}
                        className="studio-time"
                        aria-label="mm:ss"
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
                      />
                      {captions.length > 1 && (
                        <button type="button" className="icon-btn" onClick={() => setCaptions(captions.filter((_, idx) => idx !== i))} aria-label={t('studioRemove')}>
                          <UiIcon name="close" size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="studio-add-btn" onClick={() => setCaptions([...captions, { time: '', text: '' }])}>
                    <UiIcon name="plus" size={14} />
                    {t('addCaption').replace(/^\+\s*/, '')}
                  </button>
                </div>

                <div className="studio-sub">
                  <p className="studio-sub-title">
                    <UiIcon name="flag" size={15} />
                    {t('studioFlags')}
                  </p>
                  <div className="studio-flags">
                    <label className="studio-flag">
                      <input type="checkbox" checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} />
                      <span>{t('madeForKidsLabel')}</span>
                      <FieldHint text={t('madeForKidsHint')} />
                    </label>
                    <label className="studio-flag">
                      <input type="checkbox" checked={hasPaidPromotion} onChange={(e) => setHasPaidPromotion(e.target.checked)} />
                      <span>{t('paidPromoLabel')}</span>
                      <FieldHint text={t('paidPromoHint')} />
                    </label>
                    <label className="studio-flag">
                      <input type="checkbox" checked={isAiGenerated} onChange={(e) => setIsAiGenerated(e.target.checked)} />
                      <span>{t('aiContentLabel')}</span>
                      <FieldHint text={t('aiContentHint')} />
                    </label>
                    {/* Automatická kontrola nahoty (lib/nudityRules.ts): umělecké video neskryje, jen ho dá ke kontrole moderátorům. */}
                    <label className="studio-flag">
                      <input type="checkbox" className="upload-artistic" checked={isArtistic} onChange={(e) => setIsArtistic(e.target.checked)} />
                      <span>{t('artisticNudityLabel')}</span>
                      <FieldHint text={t('artisticNudityHint')} />
                    </label>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <aside className="studio-side">
            <div className="studio-side-sticky">
              {preview}
              <StudioChecklist
                title={t('studioChecklist')}
                items={[
                  { label: t('studioCheckFile'), done: !!file && !tooLongMessage, required: true },
                  { label: t('studioCheckTitle'), done: !!title.trim(), required: true },
                  { label: t('studioCheckCategory'), done: !!category, required: true },
                  { label: t('studioCheckDescription'), done: description.trim().length >= 20 },
                  { label: t('studioCheckThumb'), done: !!thumbnailFile },
                  { label: t('studioCheckTags'), done: tags.length > 0 },
                ]}
              />
              {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
              <button type="submit" className="studio-primary">
                {t('continueButton')}
              </button>
            </div>
          </aside>
        </div>
      </form>
    );
  }

  const visibilityLabel = { public: t('studioVisPublic'), subscribers: t('studioVisSubscribers'), private: t('studioVisPrivate') }[selectedCollaborators.length > 0 ? 'private' : visibility];
  const scheduleLabel =
    scheduleMode === 'now'
      ? t('studioNow')
      : `${scheduleMode === 'premiere' ? t('studioPremiere') : t('studioScheduled')}${scheduledAt ? ` · ${new Date(scheduledAt).toLocaleString(DATE_LOCALES[lang], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`;

  return (
    <form className="studio" onSubmit={handleFinalSubmit}>
      <header className="studio-head">
        <div className="studio-head-text">
          <h1>{t('visibilityAndSchedulingHeading')}</h1>
          <StudioSteps steps={[t('studioStepDetails'), t('studioStepPublish')]} current={1} />
        </div>
      </header>

      <div className="studio-grid">
        <div className="studio-main">
          <StudioCard icon="eye" title={t('whoCanSeeVideo')} hint={t('visibilityExplanationHint')}>
            <StudioChoices
              name="visibility"
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'public', icon: 'globe', title: t('studioVisPublic'), desc: t('studioVisPublicDesc') },
                { value: 'subscribers', icon: 'users', title: t('studioVisSubscribers'), desc: t('studioVisSubscribersDesc') },
                { value: 'private', icon: 'lock', title: t('studioVisPrivate'), desc: t('studioVisPrivateDesc') },
              ]}
            />
            {selectedCollaborators.length > 0 && (
              <p className="studio-note studio-note-info">
                <UiIcon name="info" size={14} />
                {t('studioCollabPrivateNote')}
              </p>
            )}
          </StudioCard>

          <StudioCard icon="calendar" title={t('publishingSectionLabel')} hint={t('premiereVsScheduledHint')}>
            <StudioChoices
              name="schedule"
              value={scheduleMode}
              onChange={setScheduleMode}
              options={[
                { value: 'now', icon: 'bolt', title: t('studioNow'), desc: t('studioNowDesc') },
                { value: 'scheduled', icon: 'calendar', title: t('studioScheduled'), desc: t('studioScheduledDesc') },
                { value: 'premiere', icon: 'sparkle', title: t('studioPremiere'), desc: t('studioPremiereDesc') },
              ]}
            />
            {scheduleMode !== 'now' && (
              <div className="studio-field" style={{ marginTop: 12 }}>
                <label htmlFor="up-when">{t('studioWhen')}</label>
                <input id="up-when" type="datetime-local" value={scheduledAt} min={localNowForInput()} onChange={(e) => setScheduledAt(e.target.value)} required />
              </div>
            )}
          </StudioCard>

          {/* Video je nahrané, ale někoho se nepodařilo pozvat ke spolupráci.
              Zůstáváme na stránce a nabídneme rovnou úpravy videa, ať to jde
              dotáhnout - dřív hláška zmizela dřív, než ji šlo přečíst. */}
          {failedInvites && (
            <div className="studio-card studio-card-error">
              <p className="error-text" style={{ margin: 0 }}>
                {t('collabInviteFailedNote').replace('{names}', failedInvites.names.join(', '))}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Link href={`/your-videos/${failedInvites.videoId}/edit`} className="studio-ghost-btn">
                  {t('collaboratorsLabel')}
                </Link>
                <button type="button" className="studio-ghost-btn" onClick={() => { uploadCommands.dismiss(); router.push('/'); }}>
                  {t('home')}
                </button>
              </div>
            </div>
          )}

          {(upload.phase === 'uploading' || upload.phase === 'saving' || upload.phase === 'processing' || (upload.phase === 'error' && upload.error)) && (
            <div className="studio-card studio-progress-card" role="status">
              {upload.phase === 'uploading' && (
                <>
                  <p className="studio-progress-label">
                    {t('uploading')} <strong>{upload.percent}%</strong>
                  </p>
                  <div className="studio-progress" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, Math.min(100, upload.percent))}%` }} />
                  </div>
                  <p className="studio-note">{t('uploadInBackgroundNote')}</p>
                </>
              )}
              {upload.phase === 'saving' && <p className="studio-progress-label">{t('savingVideoLabel')}</p>}
              {upload.phase === 'processing' && <p className="studio-progress-label">{t('processingVideoNote')}</p>}
              {upload.phase === 'error' && upload.error && <p className="error-text" style={{ margin: 0 }}>{upload.error}</p>}
            </div>
          )}
        </div>

        <aside className="studio-side">
          <div className="studio-side-sticky">
            {preview}
            <div className="studio-summary">
              <p className="studio-side-title">{t('studioSummary')}</p>
              <dl>
                <dt>{t('whoCanSeeVideo')}</dt>
                <dd>{visibilityLabel}</dd>
                <dt>{t('publishingSectionLabel')}</dt>
                <dd>{scheduleLabel}</dd>
              </dl>
            </div>
            {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}
            <div className="studio-actions">
              <button type="button" className="studio-ghost-btn" onClick={() => setStep(1)}>
                {t('backButton')}
              </button>
              {/* Dokud nahrávání běží, nesmí jít odeslat znovu - jinak by se video nahrálo
                  podruhé. Totéž když už je nahrané a nepovedly se jen pozvánky. */}
              <button type="submit" className="studio-primary" disabled={upload.busy || upload.phase === 'done' || !!failedInvites}>
                <UiIcon name="upload" size={16} />
                {upload.busy || upload.phase === 'done' ? t('processing') : t('uploadButton')}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}

/** Hashtagy z pole (mezery / čárky, bez #, malými písmeny, bez opakování). */
function parseHashtags(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[\s,]+/)) {
    const h = raw.trim().replace(/^#/, '').toLowerCase();
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** Teď v místním čase pro <input type="datetime-local" min>. */
function localNowForInput(): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60 * 1000);
  return d.toISOString().slice(0, 16);
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
