'use client';

import { useLanguage } from '@/lib/i18n';
import UiIcon from '@/components/UiIcon';

/**
 * "Připravujeme" - místo věcí, kde by se platilo (lib/payments.ts). Štítek
 * (`pill`) do řádku, nebo panel s krátkou větou.
 */
export default function ComingSoon({ pill = false, text }: { pill?: boolean; text?: string }) {
  const { t } = useLanguage();
  if (pill) return <span className="coming-soon-pill">{t('comingSoonPill')}</span>;
  return (
    <div className="coming-soon panel" role="status">
      <UiIcon name="sparkle" size={18} />
      <div>
        <p className="coming-soon-title">{t('comingSoonPill')}</p>
        <p className="coming-soon-text">{text ?? t('comingSoonPayments')}</p>
      </div>
    </div>
  );
}
