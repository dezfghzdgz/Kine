'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { NOTICE_DESCRIPTION_MIN } from '@/lib/copyrightNotice';

/**
 * Oznámení o porušení autorských práv - formulář pro držitele práv.
 *
 * Bez přihlášení (držitel práv obvykle účet nemá). Adresa videa se
 * předvyplní z ?video=<id> - odkaz sem vede z nabídky Nahlásit u videa.
 * Vyřizují moderátoři v /reports. Není to cenzura názorů: jde jen o cizí
 * dílo nahrané bez svolení a rozhoduje člověk.
 */
function CopyrightPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [description, setDescription] = useState('');
  const [goodFaith, setGoodFaith] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const id = searchParams.get('video');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setVideoUrl(`${window.location.origin}/watch/${id}`);
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const res = await fetch('/api/copyright-notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, organization, videoUrl, description, goodFaith }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(body.problems) && body.problems.length > 0) {
          setProblems(body.problems);
          setError(t('copyrightFormProblems'));
        } else {
          setError(body.error || t('copyrightSendFailed'));
        }
        return;
      }
      setDone(true);
    } catch {
      setError(t('copyrightSendFailed'));
    } finally {
      setBusy(false);
    }
  }

  const bad = (field: string) => (problems.includes(field) ? { borderColor: '#ff6b6b', boxShadow: '0 0 0 1px #ff6b6b inset' } : undefined);

  if (done) {
    return (
      <div className="form-container" style={{ maxWidth: 640 }}>
        <h1>{t('copyrightTitle')}</h1>
        <div className="panel">
          <p style={{ margin: 0, color: 'var(--text)' }}>{t('copyrightSent')}</p>
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{t('copyrightSentNote')}</p>
          <Link href="/" className="reaction-btn" style={{ display: 'inline-flex', marginTop: 16, textDecoration: 'none' }}>
            {t('home')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="form-container" style={{ maxWidth: 640 }}>
      <h1>{t('copyrightTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginTop: -6 }}>{t('copyrightIntro')}</p>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, lineHeight: 1.6 }}>{t('copyrightNotCensorship')}</p>

      <form onSubmit={submit} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          {t('copyrightName')}
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: 6, ...bad('name') }} autoComplete="name" />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          {t('copyrightEmail')}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginTop: 6, ...bad('email') }} autoComplete="email" />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          {t('copyrightOrganization')}
          <input value={organization} onChange={(e) => setOrganization(e.target.value)} style={{ width: '100%', marginTop: 6 }} autoComplete="organization" />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          {t('copyrightVideoUrl')}
          <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…/watch/…" style={{ width: '100%', marginTop: 6, ...bad('video') }} inputMode="url" />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
          {t('copyrightDescription')}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            placeholder={t('copyrightDescriptionPlaceholder')}
            style={{ width: '100%', marginTop: 6, resize: 'vertical', ...bad('description') }}
          />
          <span style={{ display: 'block', marginTop: 4 }}>
            {t('copyrightDescriptionMin').replace('{min}', String(NOTICE_DESCRIPTION_MIN))}
          </span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: problems.includes('goodFaith') ? '#ff6b6b' : 'var(--text-dim)', lineHeight: 1.5 }}>
          <input type="checkbox" checked={goodFaith} onChange={(e) => setGoodFaith(e.target.checked)} style={{ marginTop: 3, width: 'auto' }} />
          <span>{t('copyrightGoodFaith')}</span>
        </label>

        {error && <p className="error-text" style={{ margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" disabled={busy}>{busy ? t('copyrightSending') : t('copyrightSend')}</button>
        </div>
      </form>

      <p style={{ color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.6 }}>
        {t('copyrightCounterNote')} <a href="mailto:kinesupport@gmail.com" style={{ color: 'var(--text-dim)' }}>kinesupport@gmail.com</a>
      </p>
    </div>
  );
}

export default function CopyrightPage() {
  return (
    <Suspense fallback={null}>
      <CopyrightPageInner />
    </Suspense>
  );
}
