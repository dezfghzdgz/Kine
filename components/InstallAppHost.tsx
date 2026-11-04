'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage, type DictKey } from '@/lib/i18n';
import { INSTALL_OPEN_EVENT, currentInstallPlatform, type InstallPlatform } from '@/lib/installApp';
import UiIcon from './UiIcon';

const glyph = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/** Tlačítko Sdílet z iPhonu (čtvereček se šipkou nahoru) - ať je jasné, co hledat. */
function IosShareGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 3.5v11" />
      <path d="M8.5 7 12 3.5 15.5 7" />
      <path d="M8 10.5H6.5A1.5 1.5 0 0 0 5 12v7a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-7a1.5 1.5 0 0 0-1.5-1.5H16" />
    </svg>
  );
}

/** „Přidat na plochu“ - čtvereček s plusem (stejný symbol má iPhone i Android). */
function AddSquareGlyph() {
  return (
    <svg {...glyph}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}

/** Nabídka prohlížeče ⋮ (Chrome na Androidu vpravo nahoře). */
function MenuDotsGlyph() {
  return (
    <svg {...glyph}>
      <circle cx="12" cy="5.5" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

type Step = { icon: ReactNode; text: DictKey };

const IOS_STEPS: Step[] = [
  { icon: <IosShareGlyph />, text: 'installIosStep1' },
  { icon: <AddSquareGlyph />, text: 'installIosStep2' },
  { icon: <UiIcon name="check" size={20} />, text: 'installIosStep3' },
];

const ANDROID_STEPS: Step[] = [
  { icon: <MenuDotsGlyph />, text: 'installAndroidStep1' },
  { icon: <AddSquareGlyph />, text: 'installAndroidStep2' },
  { icon: <UiIcon name="check" size={20} />, text: 'installAndroidStep3' },
];

/**
 * Návod „Přidat Kine na plochu“ - jedno okno pro celou appku (je v layoutu,
 * takže přežije zavření nabídky profilu i mobilního panelu, ze kterých se
 * otevírá). Otevře ho requestInstall() z lib/installApp.ts, když Android
 * neumí ukázat systémové okno sám: iPhone/iPad, Instagram a spol., Chrome
 * ještě bez události beforeinstallprompt.
 */
export default function InstallAppHost() {
  const { t } = useLanguage();
  const [platform, setPlatform] = useState<InstallPlatform | null>(null);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const open = () => {
      setCopied(false);
      setPlatform(currentInstallPlatform());
    };
    window.addEventListener(INSTALL_OPEN_EVENT, open);
    return () => window.removeEventListener(INSTALL_OPEN_EVENT, open);
  }, []);

  useEffect(() => {
    if (!platform) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlatform(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [platform]);

  if (!platform || typeof document === 'undefined') return null;

  const close = () => setPlatform(null);
  const siteUrl = `${window.location.origin}/`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(siteUrl);
      setCopied(true);
    } catch {
      // Schránka v appce nejde - adresa je aspoň označená, jde podržet a zkopírovat.
      linkRef.current?.select();
    }
  }

  const steps = platform === 'ios' ? IOS_STEPS : platform === 'android' || platform === 'other' ? ANDROID_STEPS : null;
  const title = platform === 'in-app' ? t('installInAppTitle') : platform === 'installed' ? t('installAlreadyTitle') : t('installSheetTitle');

  return createPortal(
    <div className="install-sheet-backdrop" onClick={close}>
      <div
        className="install-sheet panel modal-glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-sheet-title"
        data-platform={platform}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="install-sheet-head">
          <span className="install-sheet-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </span>
          <h2 id="install-sheet-title">{title}</h2>
          <button ref={closeRef} type="button" className="install-sheet-close" onClick={close} aria-label={t('close')} title={t('close')}>
            <UiIcon name="close" size={16} />
          </button>
        </div>

        {steps && (
          <ol className="install-steps">
            {steps.map((step, i) => (
              <li key={step.text}>
                <span className="install-step-num">{i + 1}</span>
                <span className="install-step-icon">{step.icon}</span>
                <span className="install-step-text">{t(step.text)}</span>
              </li>
            ))}
          </ol>
        )}

        {platform === 'in-app' && (
          <>
            <p className="install-sheet-text">{t('installInAppText')}</p>
            <div className="install-link-row">
              <input ref={linkRef} readOnly value={siteUrl} aria-label={siteUrl} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="streams-btn" onClick={copyLink}>
                <UiIcon name={copied ? 'check' : 'link'} size={15} />
                {copied ? t('linkCopied') : t('installCopyLink')}
              </button>
            </div>
          </>
        )}

        {platform === 'installed' && <p className="install-sheet-text">{t('installAlreadyText')}</p>}

        {(platform === 'ios' || platform === 'android' || platform === 'other') && (
          <ul className="install-notes">
            <li>{t('installBenefits')}</li>
            {platform === 'ios' && <li>{t('installIosPushNote')}</li>}
            <li>{t('installSignInNote')}</li>
          </ul>
        )}

        <button type="button" className="streams-btn primary install-sheet-done" onClick={close}>
          {t('installGotIt')}
        </button>
      </div>
    </div>,
    document.body
  );
}
