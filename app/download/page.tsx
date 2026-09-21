'use client';

import { useLanguage } from '@/lib/i18n';

/**
 * Stránka ke stažení appky Kine do PC.
 *
 * Instalátor se staví na GitHubu (kine-desktop, GitHub Actions) a leží
 * v Releases; odkaz se dá přepnout přes NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL,
 * až bude třeba vlastní doména nebo jiné místo.
 */
const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL || 'https://github.com/dezfghzdgz/kine-desktop/releases/latest';

export default function DownloadPage() {
  const { t } = useLanguage();

  const steps = [t('downloadStep1'), t('downloadStep2'), t('downloadStep3'), t('downloadStep4')];

  return (
    <div className="form-container" style={{ maxWidth: 680 }}>
      <h1>{t('downloadTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>{t('downloadIntro')}</p>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <a href={DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="reaction-btn active" style={{ textDecoration: 'none', fontSize: 16, padding: '12px 22px' }}>
            {t('desktopDownloadButton')}
          </a>
          <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{t('downloadRequirements')}</span>
        </div>
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
        <p className="panel-heading">{t('downloadWhyTitle')}</p>
        <p style={{ margin: '8px 0 0', color: 'var(--text-dim)', lineHeight: 1.7 }}>{t('downloadWhyText')}</p>
      </div>
    </div>
  );
}
