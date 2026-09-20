'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { formatTime } from '@/lib/playerControls';
import { CLIP_MAX_S, CLIP_MIN_S, defaultClipRange, normalizeClipRange, parseClipTime } from '@/lib/clips';

/**
 * Panel "Vystřihnout klip" pod videem (lib/clips.ts, app/api/videos/clip).
 *
 * Otevře se s posledními 30 sekundami před aktuálním časem, časy se dají
 * přepsat nebo nastavit podle přehrávače ("začátek = teď"). Po odeslání
 * Cloudflare klip zpracuje a za chvíli se objeví v sekci "Klipy z tohoto
 * videa" - do té doby je tu odkaz.
 */
export default function ClipPanel({
  videoId,
  duration,
  getCurrentTime,
  onClose,
  onCreated,
}: {
  videoId: string;
  duration: number;
  /** Aktuální čas přehrávače - panel si ho bere, když divák klikne "= teď". */
  getCurrentTime: () => number;
  onClose: () => void;
  /** Klip vznikl (zpracovává se). */
  onCreated?: (clipId: string) => void;
}) {
  const { t } = useLanguage();
  const [startText, setStartText] = useState('0:00');
  const [endText, setEndText] = useState('0:30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    const range = defaultClipRange(getCurrentTime(), duration);
    setStartText(formatTime(range.start));
    setEndText(formatTime(range.end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const start = parseClipTime(startText);
  const end = parseClipTime(endText);
  const check = start !== null && end !== null ? normalizeClipRange(start, end, duration) : null;
  const length = check?.ok ? check.end - check.start : null;

  function problem(): string | null {
    if (start === null || end === null) return t('clipInvalidTime');
    if (!check || check.ok) return null;
    if (check.reason === 'too-short') return t('clipTooShort').replace('{min}', String(CLIP_MIN_S));
    if (check.reason === 'too-long') return t('clipTooLong').replace('{max}', String(CLIP_MAX_S));
    return t('clipInvalidTime');
  }

  function setFromPlayer(which: 'start' | 'end') {
    const now = Math.floor(getCurrentTime());
    if (which === 'start') setStartText(formatTime(now));
    else setEndText(formatTime(now));
  }

  function lastSeconds(seconds: number) {
    const range = defaultClipRange(getCurrentTime(), duration, seconds);
    setStartText(formatTime(range.start));
    setEndText(formatTime(range.end));
  }

  async function create() {
    if (!check?.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setError(t('clipLoginNote'));
        return;
      }
      const res = await fetch('/api/videos/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ videoId, start: check.start, end: check.end }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.code === 'limit') setError(t('clipLimitNote'));
        else if (body.code === 'not-configured') setError(t('clipNotConfiguredNote'));
        else if (body.code === 'not-public') setError(t('clipOnlyPublicNote'));
        else setError(body.error || t('clipFailed'));
        return;
      }
      setCreated({ id: body.clipId, title: body.title });
      onCreated?.(body.clipId);
    } catch {
      setError(t('clipFailed'));
    } finally {
      setBusy(false);
    }
  }

  const issue = problem();

  return (
    <div className="panel clip-panel" role="dialog" aria-label={t('clipPanelTitle')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <p className="panel-heading" style={{ margin: 0 }}>{t('clipPanelTitle')}</p>
        <button type="button" className="reaction-btn" onClick={onClose} aria-label={t('close')} style={{ minHeight: 32, padding: '4px 10px' }}>
          ✕
        </button>
      </div>

      {created ? (
        <div className="clip-created">
          <p style={{ margin: '10px 0 6px', color: 'var(--text)' }}>{t('clipCreated')}</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>{created.title}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <Link href={`/watch/${created.id}`} className="reaction-btn active" style={{ textDecoration: 'none' }}>
              {t('clipOpen')}
            </Link>
            <button type="button" className="reaction-btn" onClick={() => setCreated(null)}>
              {t('clipAnother')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: '8px 0 12px', fontSize: 13, color: 'var(--text-dim)' }}>
            {t('clipHint').replace('{min}', String(CLIP_MIN_S)).replace('{max}', String(CLIP_MAX_S))}
          </p>

          <div className="clip-fields">
            <label className="clip-field">
              <span>{t('clipStart')}</span>
              <div className="clip-field-row">
                <input value={startText} onChange={(e) => setStartText(e.target.value)} inputMode="numeric" aria-label={t('clipStart')} />
                <button type="button" className="reaction-btn" onClick={() => setFromPlayer('start')}>{t('clipNow')}</button>
              </div>
            </label>
            <label className="clip-field">
              <span>{t('clipEnd')}</span>
              <div className="clip-field-row">
                <input value={endText} onChange={(e) => setEndText(e.target.value)} inputMode="numeric" aria-label={t('clipEnd')} />
                <button type="button" className="reaction-btn" onClick={() => setFromPlayer('end')}>{t('clipNow')}</button>
              </div>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" className="reaction-btn" onClick={() => lastSeconds(15)}>{t('clipLast').replace('{n}', '15')}</button>
            <button type="button" className="reaction-btn" onClick={() => lastSeconds(30)}>{t('clipLast').replace('{n}', '30')}</button>
            <button type="button" className="reaction-btn" onClick={() => lastSeconds(60)}>{t('clipLast').replace('{n}', '60')}</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: issue ? '#ff6b6b' : 'var(--text-dim)' }}>
              {issue ?? t('clipLength').replace('{seconds}', String(length ?? 0))}
            </span>
            <button type="button" onClick={create} disabled={busy || !!issue}>
              {busy ? t('clipCreating') : t('clipCreate')}
            </button>
          </div>

          {error && <p className="error-text" style={{ marginTop: 8 }}>{error}</p>}
        </>
      )}
    </div>
  );
}
