'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { ANDROID_APK_NAME, DESKTOP_APP_NAMES, DESKTOP_FILES, detectDownloadOs, isInDesktopApp, type DesktopOs } from '@/lib/desktopRelease';

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
 * Záložka Android (0117/0118): Kine Clipper pro telefon jako APK mimo Google
 * Play (/download/android, repo kine-mobile) - na telefonu se předvybere.
 */
type Release = { version: string; publishedAt: string | null; sizeBytes: number | null } | null;

function AppIcon({ clipper, phone = false }: { clipper: boolean; phone?: boolean }) {
  return (
    <svg className="dl-icon" width="56" height="56" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0a0a0b" />
      <rect width="64" height="64" rx="14" fill="var(--brand)" fillOpacity="0.15" />
      {phone ? (
        <>
          <rect x="20" y="11" width="24" height="42" rx="5" fill="none" stroke="var(--brand)" strokeWidth="3" />
          <path d="M28 16h8" stroke="var(--brand)" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M28.5 26 L38.5 32 L28.5 38 Z" fill="var(--brand)" />
        </>
      ) : clipper ? (
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
  // Systém: předvybraný podle prohlížeče, přepínatelný (Windows / macOS / Linux).
  const [os, setOs] = useState<'windows' | 'mac' | 'linux' | 'android'>('windows');
  const [linuxDeb, setLinuxDeb] = useState(false);
  const [androidRelease, setAndroidRelease] = useState<Release | undefined>(undefined);

  useEffect(() => {
    setInApp(isInDesktopApp());
    const detected = detectDownloadOs(navigator.userAgent);
    setOs(detected === 'linux-deb' ? 'linux' : detected);
    fetch('/api/desktop/latest')
      .then((r) => r.json())
      .then((body) => {
        setRelease(body.release ?? null);
        setClipperRelease(body.clipper ?? body.release ?? null);
        setAndroidRelease(body.android?.release ?? null);
      })
      .catch(() => {
        setRelease(null);
        setClipperRelease(null);
        setAndroidRelease(null);
      });
  }, []);

  const steps = os === 'android' ? [t('downloadAndroidStep1'), t('downloadAndroidStep2'), t('downloadAndroidStep3')] : [t('downloadStep1'), t('downloadStep2'), t('downloadStep3'), t('downloadStep4')];
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

  /** Odkaz ke stažení pro vybraný systém (přesměrování na soubor v úložišti). */
  const downloadHref = (variant: 'full' | 'clipper') => {
    const q = variant === 'clipper' ? 'variant=clipper' : '';
    const path = os === 'mac' ? '/download/mac' : os === 'linux' ? '/download/linux' : '/download/windows';
    const params = [q, os === 'linux' && linuxDeb ? 'format=deb' : ''].filter(Boolean).join('&');
    return params ? `${path}?${params}` : path;
  };
  const fileOs: DesktopOs = os === 'linux' && linuxDeb ? 'linux-deb' : os === 'android' ? 'windows' : os;
  const requirements = os === 'mac' ? t('downloadRequirementsMac') : os === 'linux' ? t('downloadRequirementsLinux') : t('downloadRequirements');

  /** Kine Clipper pro Android: jedna karta, APK mimo Google Play (repo kine-mobile, /download/android). */
  const androidCard = () => {
    const line = versionLine(androidRelease);
    const features = [t('downloadAndroidFeature1'), t('downloadAndroidFeature2'), t('downloadAndroidFeature3')];
    return (
      <div className="panel dl-app primary dl-app-android">
        <div className="dl-app-head">
          <AppIcon clipper phone />
          <div style={{ minWidth: 0 }}>
            <p className="dl-app-name">{t('downloadAndroidTitle')}</p>
            <p className="dl-app-sub">{t('downloadAndroidText')}</p>
          </div>
        </div>
        <span className="dl-badge">{t('downloadAndroidBadge')}</span>
        <ul className="dl-features">
          {features.map((f) => (
            <li key={f}>
              <Check />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <a href="/download/android" className="reaction-btn dl-button active">
          {t('downloadAndroidButton')}
        </a>
        <p className="dl-meta">
          {ANDROID_APK_NAME} · {t('downloadRequirementsAndroid')}
          {line ? ` · ${line}` : ''}
        </p>
      </div>
    );
  };

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
        <a href={downloadHref(variant)} className={`reaction-btn dl-button ${clipper ? '' : 'active'}`}>
          {clipper ? t('downloadClipperButton') : t('downloadFullButton')}
        </a>
        <p className="dl-meta">
          {DESKTOP_FILES[variant][fileOs]} · {requirements}
          {line ? ` · ${line}` : ''}
        </p>
      </div>
    );
  };

  return (
    <div className="form-container" style={{ maxWidth: 860 }}>
      <h1>{os === 'android' && !inApp ? t('downloadAndroidTitle') : t('downloadTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>
        {os === 'android' && !inApp ? t('downloadAndroidText') : t('downloadIntro')} <Link href="/about">{t('aboutLink')} →</Link>
      </p>

      {inApp ? (
        <div className="panel">
          <p style={{ margin: 0, color: 'var(--text)' }}>{t('downloadInApp')}</p>
        </div>
      ) : (
        <>
          {/* Systém: Windows / macOS / Linux (AppImage nebo deb) - stejná appka, jiný soubor; Android = Kine Clipper jako APK. */}
          <div className="dl-os" role="tablist" aria-label={t('downloadOsTitle')}>
            {(['windows', 'mac', 'linux', 'android'] as const).map((o) => (
              <button key={o} type="button" role="tab" aria-selected={os === o} className={`reaction-btn dl-os-btn ${os === o ? 'active' : ''}`} onClick={() => setOs(o)}>
                {o === 'windows' ? 'Windows' : o === 'mac' ? 'macOS' : o === 'linux' ? 'Linux' : 'Android'}
              </button>
            ))}
            {os === 'linux' && (
              <label className="dl-os-format">
                <input type="checkbox" checked={linuxDeb} onChange={(e) => setLinuxDeb(e.target.checked)} /> {t('downloadLinuxDeb')}
              </label>
            )}
          </div>
          {os === 'android' ? (
            <>
              <div className="dl-apps dl-apps-one">{androidCard()}</div>
              {androidRelease === null && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>{t('downloadNotYet')}</p>}
            </>
          ) : (
            <>
              <p className="panel-heading" style={{ marginBottom: 10 }}>{t('downloadChooseTitle')}</p>
              <div className="dl-apps">
                {app('full')}
                {app('clipper')}
              </div>
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.6 }}>{t('downloadSameApp')}</p>
              {release === null && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>{t('downloadNotYet')}</p>}
            </>
          )}
          <div className="dl-note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" />
              <path d="M12 9v4M12 16.5v.5" />
            </svg>
            <span>
              {os === 'android' ? t('downloadAndroidNote') : os === 'mac' ? t('downloadMacUnsigned') : os === 'linux' ? t('downloadLinuxNote') : t('downloadUnsigned')}
              {/* Windows 11 Inteligentní řízení aplikací (Smart App Control): nepodepsaný instalátor zablokuje celý nebo jeho část. */}
              {os === 'windows' && <span className="dl-note-sac">{t('downloadSmartAppControl')}</span>}
            </span>
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
