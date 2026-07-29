'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n';

const PRESET_AMOUNTS = [50, 100, 250, 500];

export default function DonatePage() {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<number | null>(100);
  const [customAmount, setCustomAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDonate() {
    setError(null);
    const amount = selected ?? Number(customAmount);
    if (!amount || amount < 20) {
      setError(t('donateMinAmountNote'));
      return;
    }

    setLoading(true);
    const res = await fetch('/api/donate/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCzk: amount }),
    });
    const data = await res.json();
    setLoading(false);

    if (data.url) {
      window.location.href = data.url;
    } else {
      setError(data.error ?? t('donateGenericError'));
    }
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <p className="section-title">{t('donatePageTitle')}</p>

      <div className="panel" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{t('donateMessageParagraph1')}</p>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>{t('donateMessageParagraph2')}</p>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 12, fontWeight: 600 }}>{t('donateMessageParagraph3')}</p>
      </div>

      <div className="panel">
        <p className="panel-heading">{t('donateAmountLabel')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {PRESET_AMOUNTS.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => { setSelected(amt); setCustomAmount(''); }}
              style={{
                background: selected === amt ? 'var(--text)' : 'var(--panel-raised)',
                color: selected === amt ? 'var(--bg)' : 'var(--text)',
                border: '1px solid var(--border)',
              }}
            >
              {amt} Kč
            </button>
          ))}
        </div>
        <input
          type="number"
          placeholder={t('donateCustomAmountPlaceholder')}
          value={customAmount}
          onChange={(e) => { setCustomAmount(e.target.value); setSelected(null); }}
          min={20}
          style={{ marginBottom: 12 }}
        />
        {error && <p className="error-text">{error}</p>}
        <button type="button" onClick={handleDonate} disabled={loading} style={{ width: '100%' }}>
          {loading ? t('processing') : t('donateButtonLabel')}
        </button>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10 }}>{t('donateSecurityNote')}</p>
      </div>
    </div>
  );
}
