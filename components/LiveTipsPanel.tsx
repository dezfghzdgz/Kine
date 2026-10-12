'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { formatTipAmount } from '@/lib/liveTips';

type TipsInfo = {
  available: boolean;
  enabled: boolean;
  reason: 'missing' | 'banned' | 'not-connected' | 'disabled' | 'unavailable' | null;
  feePercent?: number;
  totals?: Record<string, { day: number; all: number }>;
  tips: { id: number; name: string; amountCents: number; shareCents: number; currency: string; message: string; at: string }[];
};

/**
 * Studio živého vysílání -> Podpory: zapnout / vypnout, co je potřeba
 * (propojený Stripe), poslední podpory se vzkazy, součty a odkaz na
 * překryv pro OBS, který podpory čte nahlas.
 */
export default function LiveTipsPanel({ token, userId, onCopy }: { token: string | null; userId: string; onCopy: (text: string) => void }) {
  const { t, lang } = useLanguage();
  const [info, setInfo] = useState<TipsInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!token) return;
    try {
      const res = await fetch('/api/live/tips', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setInfo(body);
    } catch {
      // Panel se ukáže až s daty.
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggle(enabled: boolean) {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/live/tips', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body?.error ?? t('tipFailed'));
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!info) return null;
  const overlayUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/live/${userId}/chat?overlay=1&tts=tips`;
  const switchedOn = info.reason !== 'disabled';
  const totals = Object.entries(info.totals ?? {});

  return (
    <div className="panel live-tips-panel">
      <p className="panel-heading">💛 {t('tipsPanelTitle')}</p>
      {!info.available ? (
        <p className="live-hint" style={{ marginTop: 0 }}>{t('tipsUnavailable')}</p>
      ) : (
        <>
          <p className="live-hint" style={{ marginTop: 0 }}>{t('tipsPanelIntro').replace('{fee}', String(info.feePercent ?? 15))}</p>
          {info.reason === 'not-connected' ? (
            <p className="live-hint">
              {t('tipsNotConnected')} <Link href="/settings#earnings">{t('tipsConnectLink')} →</Link>
            </p>
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" className="live-tips-toggle" style={{ width: 'auto' }} checked={switchedOn} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
              {t('tipsEnabledLabel')}
            </label>
          )}
          {error && <p className="error-text">{error}</p>}

          {totals.length > 0 && (
            <p className="live-hint">
              {totals
                .map(([cur, v]) => `${t('tipsTotalDay').replace('{amount}', formatTipAmount(v.day, cur, lang))} · ${t('tipsTotalAll').replace('{amount}', formatTipAmount(v.all, cur, lang))}`)
                .join(' | ')}
            </p>
          )}
          {info.tips.length === 0 ? (
            <p className="live-hint">{t('tipsEmpty')}</p>
          ) : (
            <div className="tips-list">
              {info.tips.map((tip) => (
                <div key={tip.id} className="tips-row">
                  <span className="tips-row-amount">{formatTipAmount(tip.amountCents, tip.currency, lang)}</span>
                  <span className="tips-row-text">
                    <b>{tip.name}</b>
                    {tip.message ? `: ${tip.message}` : ''}
                  </span>
                  <span className="tips-row-time">{new Date(tip.at).toLocaleString(DATE_LOCALES[lang], { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          )}

          <div className="live-key-row" style={{ marginTop: 12 }}>
            <span className="live-key-label">{t('tipsOverlayTts')}</span>
            <code className="live-key-value">{overlayUrl}</code>
            <button type="button" className="live-small-btn" onClick={() => onCopy(overlayUrl)}>
              {t('liveCopy')}
            </button>
          </div>
          <p className="live-hint">{t('tipsOverlayTtsHint')}</p>
        </>
      )}
    </div>
  );
}
