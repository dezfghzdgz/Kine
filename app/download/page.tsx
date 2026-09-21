'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';

/**
 * Stránka ke stažení appky Kine do PC.
 *
 * Tlačítko vede na /download/windows - to pošle prohlížeč rovnou na
 * nejnovější instalátor (GitHub Releases repa kine-desktop), takže
 * uživatel GitHub nevidí, jen mu začne stahování. Verze a datum se
 * berou z /api/desktop/latest.
 */
export default function DownloadPage() {
  const { t } = useLanguage();
  const [release, setRelease] = useState<{ version: string; publishedAt: string | null; sizeBytes: number | null } | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/desktop/latest')
      .then((r) => r.json())
      .then((body) => setRelease(body.release ?? null))
      .catch(() => setRelease(null));
  }, []);

  const steps = [t('downloadStep1'), t('downloadStep2'), t('downloadStep3'), t('downloadStep4')];
  const versionLine = release
    ? [
        `${t('downloadVersion')} ${release.version}`,
        release.publishedAt ? new Date(release.publishedAt).toLocaleDateString('cs-CZ') : null,
        release.sizeBytes ? `${Math.round(release.sizeBytes / 1024 / 1024)} MB` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="form-container" style={{ maxWidth: 680 }}>
      <h1>{t('downloadTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>{t('downloadIntro')}</p>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <a href="/download/windows" className="reaction-btn active" style={{ textDecoration: 'none', fontSize: 16, padding: '12px 22px' }}>
            {t('desktopDownloadButton')}
          </a>
          <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>
            {t('downloadRequirements')}
            {versionLine ? ` · ${versionLine}` : ''}
          </span>
        </div>
        {release === null && <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)' }}>{t('downloadNotYet')}</p>}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.6 }}>{t('downloadUnsigned')}</p>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <p className="panel-heading">{t('downloadHowTitle')}</p>
        <ol style={{ margin: '8px 0 0', paddingLeft: 22, color: 'var(--text-dim)', lineHeight: 1.7 }}>
          {steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <p className="panel-heading">{t('downloadFreePlusTitle')}</p>
        <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', lineHeight: 1.7 }}>
          {t('downloadFreePlusText')} <Link href="/plus">{t('downloadFreePlusLink')}</Link>
        </p>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <p className="panel-heading">{t('downloadWhyTitle')}</p>
        <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', lineHeight: 1.7 }}>{t('downloadWhyText')}</p>
      </div>
    </div>
  );
}
