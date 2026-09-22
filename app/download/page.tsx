'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { DESKTOP_APP_NAMES, isInDesktopApp } from '@/lib/desktopRelease';

/**
 * Stránka ke stažení appek do PC.
 *
 * Dvě různé appky, ať je na první pohled poznat, co si člověk bere:
 *  - "Kine" (Kine do PC): Kine jako aplikace na koukání videí + klipovač
 *    v jednom okně (ikona s trojúhelníkem),
 *  - "Kine Clipper": jen klipovač v liště u hodin, Kine se otvírá
 *    v prohlížeči (ikona se svorkami).
 * Klipovač je součástí Kine do PC, takže obě naráz nikdo nepotřebuje.
 * Odkazy vedou na /download/windows, které pošle prohlížeč rovnou na
 * instalátor v našem úložišti. Verze a datum se berou z /api/desktop/latest.
 */
type Release = { version: string; publishedAt: string | null; sizeBytes: number | null } | null;

function AppIcon({ clipper }: { clipper: boolean }) {
  return (
    <svg className="dl-icon" width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0a0a0b" />
      <rect width="64" height="64" rx="14" fill="var(--brand)" fillOpacity="0.15" />
      {clipper ? (
        <>
          <path d="M19.5 17 H13 V47 H19.5" fill="none" stroke="var(--brand)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M44.5 17 H51 V47 H44.5" fill="none" stroke="var(--brand)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M26.5 23 L42.5 32 L26.5 41 Z" fill="var(--brand)" />
        </>
      ) : (
        <path d="M24 18 L46 32 L24 46 Z" fill="var(--brand)" />
      )}
    </svg>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export default function DownloadPage() {
  const { t, lang } = useLanguage();
  const [release, setRelease] = useState<Release | undefined>(undefined);
  const [clipperRelease, setClipperRelease] = useState<Release | undefined>(undefined);
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(isInDesktopApp());
    fetch('/api/desktop/latest')
      .then((r) => r.json())
      .then((body) => {
        setRelease(body.release ?? null);
        setClipperRelease(body.clipper ?? body.release ?? null);
      })
      .catch(() => {
        setRelease(null);
        setClipperRelease(null);
      });
  }, []);

  const steps = [t('downloadStep1'), t('downloadStep2'), t('downloadStep3'), t('downloadStep4')];
  const versionLine = (r: Release | undefined) =>
    r
      ? [
          `${t('downloadVersion')} ${r.version}`,
          r.publishedAt ? new Date(r.publishedAt).toLocaleDateString(lang === 'en' ? 'en-GB' : lang) : null,
          r.sizeBytes ? `${Math.round(r.sizeBytes / 1024 / 1024)} MB` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  const app = (variant: 'full' | 'clipper') => {
    const clipper = variant === 'clipper';
    const features = clipper
      ? [t('downloadClipperFeature1'), t('downloadClipperFeature2'), t('downloadClipperFeature3')]
      : [t('downloadFullFeature1'), t('downloadFullFeature2'), t('downloadFullFeature3')];
    const line = versionLine(clipper ? clipperRelease : release);
    return (
      <div className={`panel dl-app ${clipper ? '' : 'primary'}`}>
        <div className="dl-app-head">
          <AppIcon clipper={clipper} />
          <div style={{ minWidth: 0 }}>
            <p className="dl-app-name">{clipper ? t('downloadClipperTitle') : t('downloadFullTitle')}</p>
            <p className="dl-app-sub">{clipper ? t('downloadClipperText') : t('downloadFullText')}</p>
          </div>
        </div>
        <span className={`dl-badge ${clipper ? '' : 'brand'}`}>{clipper ? t('downloadOnlyClipper') : t('downloadIncludesClipper')}</span>
        <ul className="dl-features">
          {features.map((f) => (
            <li key={f}>
              <Check />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <a href={clipper ? '/download/windows?variant=clipper' : '/download/windows'} className={`reaction-btn dl-button ${clipper ? '' : 'active'}`}>
          {clipper ? t('downloadClipperButton') : t('downloadFullButton')}
        </a>
        <p className="dl-meta">
          {DESKTOP_APP_NAMES[variant]}.exe · {t('downloadRequirements')}
          {line ? ` · ${line}` : ''}
        </p>
      </div>
    );
  };

  return (
    <div className="form-container" style={{ maxWidth: 860 }}>
      <h1>{t('downloadTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>{t('downloadIntro')}</p>

      {inApp ? (
        <div className="panel">
          <p style={{ margin: 0, color: 'var(--text)' }}>{t('downloadInApp')}</p>
        </div>
      ) : (
        <>
          <p className="panel-heading" style={{ marginBottom: 10 }}>{t('downloadChooseTitle')}</p>
          <div className="dl-apps">
            {app('full')}
            {app('clipper')}
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.6 }}>{t('downloadSameApp')}</p>
          {release === null && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>{t('downloadNotYet')}</p>}
          <div className="dl-note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />
              <path d="M12 9v4M12 16.5v.5" />
            </svg>
            <span>{t('downloadUnsigned')}</span>
          </div>
        </>
      )}

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
