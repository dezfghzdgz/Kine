'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { CATEGORY_KEYS } from '@/lib/categories';
import { channelRoom, liveElapsed } from '@/lib/liveChat';
import LiveChat from '@/components/LiveChat';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast, { ToastType } from '@/components/Toast';

type Setup = {
  configured: boolean;
  migrated: boolean;
  input: { rtmpsUrl: string; streamKey: string; srtUrl: string | null; createdAt: string } | null;
  stream: {
    title: string;
    description: string;
    category: string | null;
    live: boolean;
    startedAt: string | null;
    endedAt: string | null;
    playerUrl: string;
  } | null;
};

type Recording = {
  uid: string;
  state: string;
  created: string | null;
  duration: number | null;
  thumbnail: string | null;
  readyToStream: boolean;
  videoId: string | null;
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Studio živého vysílání: klíč pro OBS, název a popis přenosu, náhled,
 * chat (s mazáním) a záznamy, které jde jedním klikem zveřejnit jako video.
 */
export default function LiveStudioPage() {
  const { t, lang } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('catGaming');
  const [savingDetails, setSavingDetails] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [publishing, setPublishing] = useState<{ uid: string; title: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const detailsTouchedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setUserId(data.session?.user?.id ?? null);
      setChecked(true);
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function api(path: string, init: RequestInit = {}) {
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body;
  }

  async function loadSetup() {
    try {
      const body: Setup = await api('/api/live/me');
      setSetup(body);
      setLoadError(null);
      if (body.stream && !detailsTouchedRef.current) {
        setTitle(body.stream.title ?? '');
        setDescription(body.stream.description ?? '');
        if (body.stream.category) setCategory(body.stream.category);
      }
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }

  async function loadRecordings() {
    try {
      const body = await api('/api/live/recordings');
      setRecordings(Array.isArray(body.recordings) ? body.recordings : []);
    } catch {
      // Záznamy nejsou k dispozici - sekce zůstane prázdná.
    }
  }

  useEffect(() => {
    if (!token) return;
    loadSetup();
    loadRecordings();
    // Stav (živě / offline) každých 5 s - studio je otevřené hlavně při vysílání.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadSetup();
    }, 5000);
    const recTimer = setInterval(() => {
      if (document.visibilityState === 'visible') loadRecordings();
    }, 60 * 1000);
    return () => {
      clearInterval(timer);
      clearInterval(recTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function createKey(action: 'create' | 'reset') {
    setBusy(true);
    try {
      const body = await api('/api/live/me', { method: 'POST', body: JSON.stringify({ action }) });
      setSetup((s) => (s ? { ...s, input: body.input, stream: body.stream ?? s.stream } : s));
      setShowKey(false);
      if (action === 'reset') setToast({ message: t('liveKeyResetDone'), type: 'success' });
    } catch (e) {
      setToast({ message: (e as Error).message, type: 'error' });
    } finally {
      setBusy(false);
      setConfirmReset(false);
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSavingDetails(true);
    try {
      const body = await api('/api/live/me', { method: 'POST', body: JSON.stringify({ action: 'details', title, description, category }) });
      setSetup((s) => (s ? { ...s, stream: body.stream } : s));
      detailsTouchedRef.current = false;
      setToast({ message: t('liveSaved'), type: 'success' });
    } catch (err) {
      setToast({ message: (err as Error).message, type: 'error' });
    } finally {
      setSavingDetails(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: t('liveCopied'), type: 'success' });
    } catch {
      setToast({ message: text, type: 'error' });
    }
  }

  async function publish() {
    if (!publishing) return;
    setBusy(true);
    try {
      const body = await api('/api/live/recordings', {
        method: 'POST',
        body: JSON.stringify({ videoUid: publishing.uid, title: publishing.title, description, visibility: 'public', language: lang }),
      });
      setRecordings((list) => list.map((r) => (r.uid === publishing.uid ? { ...r, videoId: body.videoId } : r)));
      setPublishing(null);
      setToast({ message: t('livePublished'), type: 'success' });
    } catch (e) {
      setToast({ message: (e as Error).message, type: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  if (!token || !userId) {
    return (
      <div className="auth-gate">
        <p>{t('liveSignInToStream')}</p>
        <Link href="/login?next=%2Flive">{t('loginLink')}</Link>
      </div>
    );
  }
  if (!setup) {
    return loadError ? (
      <div className="auth-gate">
        <p>{loadError}</p>
      </div>
    ) : (
      <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>
    );
  }

  const stream = setup.stream;
  const input = setup.input;

  return (
    <div className="live-studio">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {confirmReset && (
        <ConfirmDialog message={t('liveResetKeyConfirm')} onConfirm={() => createKey('reset')} onCancel={() => setConfirmReset(false)} />
      )}
      <h1 className="section-title" style={{ fontSize: 'var(--fs-2xl)' }}>
        <span className="live-dot" aria-hidden="true" /> {t('liveStudioTitle')}
      </h1>

      {!setup.migrated && <p className="feed-notice">{t('liveNotMigratedNote')}</p>}
      {setup.migrated && !setup.configured && <p className="feed-notice">{t('liveNotConfiguredNote')}</p>}

      {setup.migrated && setup.configured && !input && (
        <div className="panel live-intro">
          <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>{t('liveStudioIntro')}</p>
          <button type="button" onClick={() => createKey('create')} disabled={busy}>
            {busy ? t('liveCreating') : t('liveCreateKeyButton')}
          </button>
        </div>
      )}

      {input && (
        <div className="live-studio-grid">
          <div className="live-studio-main panel-stack">
            <div className="panel live-status-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                {stream?.live ? (
                  <p className="live-status live-status-on">
                    <span className="live-pill">● {t('liveBadge')}</span> {t('liveStatusLive')}
                    {stream.startedAt && <span className="live-status-time">{liveElapsed(stream.startedAt, now)}</span>}
                  </p>
                ) : (
                  <p className="live-status">
                    <span className="live-status-off-dot" aria-hidden="true" /> {t('liveStatusOffline')}
                  </p>
                )}
                <Link href={`/live/${userId}`} className="live-studio-link">
                  {t('liveOpenPublicPage')} →
                </Link>
              </div>
              {stream?.live && (
                <div className="player-wrap" style={{ aspectRatio: '16/9', marginTop: 12 }}>
                  <iframe
                    src={`${stream.playerUrl}${stream.playerUrl.includes('?') ? '&' : '?'}muted=true`}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen;"
                    allowFullScreen
                    title={t('liveStudioTitle')}
                  />
                </div>
              )}
            </div>

            <form className="panel" onSubmit={saveDetails} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="panel-heading">{t('liveDetailsHeading')}</p>
              <label className="live-field">
                <span>{t('liveTitleLabel')}</span>
                <input
                  type="text"
                  value={title}
                  maxLength={100}
                  onChange={(e) => {
                    detailsTouchedRef.current = true;
                    setTitle(e.target.value);
                  }}
                />
              </label>
              <label className="live-field">
                <span>{t('description2')}</span>
                <textarea
                  rows={3}
                  value={description}
                  maxLength={2000}
                  onChange={(e) => {
                    detailsTouchedRef.current = true;
                    setDescription(e.target.value);
                  }}
                />
              </label>
              <label className="live-field">
                <span>{t('categoryLabel')}</span>
                <select
                  value={category}
                  onChange={(e) => {
                    detailsTouchedRef.current = true;
                    setCategory(e.target.value);
                  }}
                >
                  {CATEGORY_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {t(key as any)}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button type="submit" disabled={savingDetails}>
                  {t('saveChanges')}
                </button>
              </div>
            </form>

            <div className="panel">
              <p className="panel-heading">{t('liveObsHeading')}</p>
              <div className="live-key-row">
                <span className="live-key-label">{t('liveServerLabel')}</span>
                <code className="live-key-value">{input.rtmpsUrl}</code>
                <button type="button" className="live-small-btn" onClick={() => copy(input.rtmpsUrl)}>
                  {t('liveCopy')}
                </button>
              </div>
              <div className="live-key-row">
                <span className="live-key-label">{t('liveKeyLabel')}</span>
                <code className="live-key-value">{showKey ? input.streamKey : '•'.repeat(Math.min(32, input.streamKey.length))}</code>
                <button type="button" className="live-small-btn" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? t('liveKeyHide') : t('liveKeyShow')}
                </button>
                <button type="button" className="live-small-btn" onClick={() => copy(input.streamKey)}>
                  {t('liveCopy')}
                </button>
              </div>
              <p className="live-hint">{t('liveKeySecretNote')}</p>
              <button type="button" className="live-small-btn live-danger" onClick={() => setConfirmReset(true)} disabled={busy}>
                {t('liveResetKey')}
              </button>
            </div>

            <div className="panel">
              <p className="panel-heading">{t('liveGuideHeading')}</p>
              <ol className="live-guide">
                <li>{t('liveGuideStep1')}</li>
                <li>{t('liveGuideStep2')}</li>
                <li>{t('liveGuideStep3')}</li>
                <li>{t('liveGuideStep4')}</li>
              </ol>
            </div>

            <div className="panel">
              <p className="panel-heading">{t('liveRecordingsHeading')}</p>
              {recordings.length === 0 && <p className="live-hint">{t('liveRecordingsEmpty')}</p>}
              <div className="live-recordings">
                {recordings.map((r) => (
                  <div key={r.uid} className="live-recording">
                    <div className="live-recording-thumb">
                      {r.thumbnail ? <img src={r.thumbnail} alt="" loading="lazy" decoding="async" /> : null}
                      {r.duration ? <span className="live-recording-duration">{formatDuration(r.duration)}</span> : null}
                    </div>
                    <div className="live-recording-info">
                      <p className="live-recording-date">{r.created ? new Date(r.created).toLocaleString(DATE_LOCALES[lang]) : ''}</p>
                      {r.state === 'live-inprogress' ? (
                        <span className="live-pill">● {t('liveRecordingInProgress')}</span>
                      ) : r.videoId ? (
                        <Link href={`/watch/${r.videoId}`} className="live-studio-link">
                          ✓ {t('livePublished')} · {t('liveOpenVideo')} →
                        </Link>
                      ) : !r.readyToStream ? (
                        <span className="live-hint">{t('liveRecordingProcessing')}</span>
                      ) : publishing?.uid === r.uid ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <input
                            type="text"
                            value={publishing.title}
                            maxLength={150}
                            onChange={(e) => setPublishing({ uid: r.uid, title: e.target.value })}
                            aria-label={t('videoTitle')}
                            style={{ flex: 1, minWidth: 180 }}
                          />
                          <button type="button" onClick={publish} disabled={busy || !publishing.title.trim()}>
                            {t('livePublishRecording')}
                          </button>
                          <button type="button" className="live-small-btn" onClick={() => setPublishing(null)}>
                            {t('cancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="live-small-btn"
                          onClick={() =>
                            setPublishing({
                              uid: r.uid,
                              title:
                                (stream?.title || '').trim() ||
                                t('liveDefaultRecordingTitle').replace('{date}', r.created ? new Date(r.created).toLocaleDateString(DATE_LOCALES[lang]) : ''),
                            })
                          }
                        >
                          {t('livePublishRecording')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="live-hint">{t('liveRecordingsNote')}</p>
            </div>
          </div>

          <LiveChat room={channelRoom(userId)} canModerate className="live-side" />
        </div>
      )}
    </div>
  );
}
