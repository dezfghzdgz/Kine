'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { dismissPushOffer, enablePush, shouldOfferPush } from '@/lib/pushClient';
import UiIcon from './UiIcon';

/**
 * Nabídka ve zvonečku: „Oznámení i mimo Kine?“ - jen přihlášenému, jen když
 * prohlížeč push umí a ještě se nerozhodl. Zavřít = 30 dní klid. Prohlížeč se
 * na povolení zeptá až po kliknutí na Zapnout (nikdy sám od sebe).
 */
export default function PushOffer() {
  const { t, lang } = useLanguage();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShow(shouldOfferPush());
  }, []);

  if (!show) return null;
  return (
    <div className="push-offer" role="status">
      <UiIcon name="bell" size={16} />
      <span className="push-offer-text">{t('pushOfferText')}</span>
      <button
        type="button"
        className="push-offer-on"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const result = await enablePush(lang);
          setBusy(false);
          if (result !== 'error') setShow(false);
        }}
      >
        {t('pushTurnOn')}
      </button>
      <button
        type="button"
        className="icon-btn push-offer-close"
        aria-label={t('close')}
        onClick={() => {
          dismissPushOffer();
          setShow(false);
        }}
      >
        <UiIcon name="close" size={13} />
      </button>
    </div>
  );
}
