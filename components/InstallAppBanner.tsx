'use client';

import { useLanguage } from '@/lib/i18n';
import { requestInstall } from '@/lib/installApp';
import UiIcon from './UiIcon';

/**
 * „Kine jako appka v telefonu“ - pruh na Domovské pro přihlášené na telefonu
 * a tabletu (kdy přesně: lib/homeBanner.ts). Tlačítko na Androidu otevře
 * systémové okno „Instalovat“, jinak návod (lib/installApp.ts).
 */
export default function InstallAppBanner({ onDone, onDismiss }: { onDone: () => void; onDismiss: () => void }) {
  const { t } = useLanguage();

  async function install() {
    const result = await requestInstall();
    if (result === 'accepted') onDone();
    // Okno „Instalovat“ zavřené bez instalace = teď ne; pruh se vrátí za čas.
    else if (result === 'dismissed') onDismiss();
  }

  return (
    <div className="panel install-banner" role="note">
      <span className="install-banner-icon" aria-hidden="true">
        <UiIcon name="phone" size={22} />
      </span>
      <div className="install-banner-text">
        <strong>{t('installBannerTitle')}</strong>
        <span>{t('installBannerText')}</span>
      </div>
      <button type="button" className="streams-btn primary install-banner-button" onClick={install}>
        <UiIcon name="plus" size={16} />
        {t('installButton')}
      </button>
      <button type="button" className="desktop-banner-close install-banner-close" onClick={onDismiss} aria-label={t('close')} title={t('close')}>
        ✕
      </button>
    </div>
  );
}
