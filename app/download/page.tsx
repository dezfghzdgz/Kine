'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { isInDesktopApp } from '@/lib/desktopRelease';

/**
 * Stránka ke stažení appky Kine do PC.
 *
 * Dvě volby, jeden instalátor: "Kine + klipy" (Kine jako aplikace na
 * koukání videí + klipovač) a "jen klipovač" (malá appka v liště). Odkazy
 * vedou na /download/windows, které pošle prohlížeč rovnou na instalátor
 * v našem úložišti - uživatel nikam nechodí, jen mu začne stahování.
 * Podle názvu staženého souboru si appka předvyplní režim; v nastavení
 * jde kdykoliv přepnout. Verze a datum se berou z /api/desktop/latest.
 */
export default function DownloadPage() {
  const { t } = useLanguage();
  const [release, setRelease] = useState<{ version: string; publishedAt: string | null; sizeBytes: number | null } | null | undefined>(undefined);
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(isInDesktopApp());
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

  const card = (title: string, text: string, href: string, button: string, primary: boolean) => (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minWidth: 240, margin: 0 }}>
      <p className="panel-heading" style={{ margin: 0, color: primary ? 'var(--brand)' : undefined }}>{title}</p>
      <p style={{ margin: 0, color: 'var(--text-dim)', lineHeight: 1.6, fontSize: 14, flex: 1 }}>{text}</p>
      <a href={href} className={`reaction-btn ${primary ? 'active' : ''}`} style={{ textDecoration: 'none', fontSize: 15, padding: '11px 18px', alignSelf: 'flex-start' }}>
        {button}
      </a>
    </div>
  );

  return (
    <div className="form-container" style={{ maxWidth: 760 }}>
      <h1>{t('downloadTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>{t('downloadIntro')}</p>

      {inApp ? (
        <div className="panel">
          <p style={{ margin: 0, color: 'var(--text)' }}>{t('downloadInApp')}</p>
        </div>
      ) : (
        <>
          <p className="panel-heading" style={{ marginBottom: 10 }}>{t('downloadChooseTitle')}</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {card(t('downloadFullTitle'), t('downloadFullText'), '/download/windows', t('downloadFullButton'), true)}
            {card(t('downloadClipperTitle'), t('downloadClipperText'), '/download/windows?variant=clipper', t('downloadClipperButton'), false)}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.6 }}>
            {t('downloadSameApp')} {t('downloadRequirements')}
            {versionLine ? ` · ${versionLine}` : ''}
          </p>
          {release === null && <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>{t('downloadNotYet')}</p>}
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-faint)', lineHeight: 1.6 }}>{t('downloadUnsigned')}</p>
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
