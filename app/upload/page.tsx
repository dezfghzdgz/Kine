'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import FieldHint from '@/components/FieldHint';
import { useLanguage } from '@/lib/i18n';

const CATEGORY_KEYS = [
  'catCars', 'catTravel', 'catFilm', 'catGaming', 'catMusic',
  'catComedy', 'catPeople', 'catHowTo', 'catNonprofit', 'catSports',
  'catScience', 'catEducation', 'catEntertainment', 'catNews', 'catPets',
] as const;

const LANGUAGE_OPTIONS = [
  { code: 'cs', key: 'langOptCzech' },
  { code: 'sk', key: 'langOptSlovak' },
  { code: 'en', key: 'langOptEnglish' },
  { code: 'de', key: 'langOptGerman' },
  { code: 'other', key: 'langOptOther' },
] as const;

type Visibility = 'public' | 'subscribers' | 'private';
type ScheduleMode = 'now' | 'scheduled' | 'premiere';

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
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || 'Nepodařilo se připravit upload.');

      await uploadWithProgress(urlData.uploadURL, file, setProgress);

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
          visibility,
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

      setStatus('processing');
      await waitUntilReady(newVideoId);

      setStatus('done');
      router.push('/');
    } catch (err: any) {
      setError(err.message);
      setStatus('idle');
    }
  }

  async function waitUntilReady(videoId: string) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await fetch('/api/videos/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await res.json();
      if (data.status === 'ready') return;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }

  if (checkingAuth) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!isLoggedIn) {
    return (
      <div className="auth-gate">
        <p>Pro nahrání videa se musíš nejdřív přihlásit.</p>
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
            <FieldHint text="Vyber video ze svého počítače. Podporované formáty: MP4, MOV a další běžné formáty. Appka ho po odeslání nahraje na Cloudflare." />
          </p>
          <input
            type="file"
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreviewUrl(f ? URL.createObjectURL(f) : null);
            }}
            required
          />

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
            <FieldHint text="Nepovinné. Pokud nevybereš vlastní obrázek, appka použije automaticky vygenerovaný snímek z videa." />
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
                  const ok = confirm(
                    'Tenhle obrázek má jiný poměr stran než video - bude oříznutý shora/zdola a bude vypadat trochu jinak, než jak ho vidíš teď. Opravdu ho chceš použít?'
                  );
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
              Název videa
              <FieldHint text="Krátký, výstižný název - je to první věc, kterou diváci uvidí v seznamu videí." />
            </label>
            <input type="text" placeholder={t('videoTitle')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
          </div>

          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              {t('description2')}
              <FieldHint text="Nepovinné. Zobrazí se v záložce 'Popis' pod videem. Můžeš sem napsat i časy jako 1:23 - v komentářích se z nich automaticky stanou klikací odkazy, tady zatím ne." />
            </label>
            <textarea placeholder={t('optionalDescription')} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            <input
              type="text"
              placeholder="#hry #vtipné #vlog"
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
              <FieldHint text="Video se rovnou zařadí do vybraných playlistů, jakmile ho nahraješ." />
            </label>
            <button
              type="button"
              onClick={() => setPlaylistMenuOpen((v) => !v)}
              style={{ background: 'var(--panel-raised)', color: 'var(--text)', width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }}
            >
              <span>
                {selectedPlaylists.length === 0
                  ? t('addToPlaylistPlaceholder')
                  : `Vybráno: ${selectedPlaylists.length}`}
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
          <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {t('chapters')}
            <FieldHint text="Nepovinné. Rozděl video na části s vlastními názvy (např. 0:00 Úvod, 2:30 Hlavní část). Zobrazí se jako klikací značky přímo na časové ose přehrávače." />
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
            <FieldHint text="Nepovinné. Napiš text a čas, kdy se má na videu zobrazit. Přidávej postupně po jednotlivých řádcích." />
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
      <h1>Viditelnost a plánování</h1>

      <div className="panel">
        <p className="panel-heading">
          {t('whoCanSeeVideo')}
          <FieldHint text="Veřejné vidí kdokoliv. 'Jen pro odběratele' zatím funguje jako soukromé, dokud nedokončíme ověřování odběrů. Soukromé vidíš jen ty." />
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
          <FieldHint text="Premiéra je hned viditelná s odpočtem do vydání. Naplánováno je úplně skryté, dokud nenastane vybraný čas." />
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
      {status === 'uploading' && <p>{t('uploading')} {progress}%</p>}
      {status === 'saving' && <p>Ukládám video…</p>}
      {status === 'processing' && <p>Cloudflare zpracovává video, chvilku strpení…</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setStep(1)} style={{ background: 'var(--panel-raised)', color: 'var(--text)' }}>
          ← Zpět
        </button>
        <button type="submit" disabled={status !== 'idle'} style={{ flex: 1 }}>
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
    xhr.onerror = () => reject(new Error('Chyba sítě při nahrávání.'));
    xhr.send(formData);
  });
}
