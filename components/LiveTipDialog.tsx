'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';
import { TIP_CURRENCIES, TIP_LIMITS, TIP_MESSAGE_MAX, defaultTipCurrency, formatTipAmount, type TipCurrency } from '@/lib/liveTips';

/**
 * Podpora ve vysílání (tlačítko 💛 u přenosu): částka, měna, vzkaz -> platba
 * přes Stripe. Vzkaz se po zaplacení ukáže zvýrazněný v chatu a tvůrce si
 * ho může nechat přečíst nahlas. Peníze jdou tvůrci (Kine si nechá poplatek).
 *
 * S videoId je to Super díky pod videem (app/api/videos/thanks): stejné
 * částky a poplatek, vzkaz se ukáže zvýrazněný pod videem.
 */
export default function LiveTipDialog({
  channelId,
  channelName,
  feePercent,
  loggedIn,
  onClose,
  videoId,
}: {
  channelId: string;
  channelName: string;
  feePercent: number;
  loggedIn: boolean;
  onClose: () => void;
  videoId?: string;
}) {
  const { t, lang } = useLanguage();
  const [currency, setCurrency] = useState<TipCurrency>(() => defaultTipCurrency(lang));
  const [amount, setAmount] = useState<string>(() => String(TIP_LIMITS[defaultTipCurrency(lang)].presets[1]));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    dialogRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const limits = TIP_LIMITS[currency];
  const value = Number(amount.replace(',', '.'));
  const valid = Number.isFinite(value) && value >= limits.min && value <= limits.max;
  const range = t('tipRange')
    .replace('{min}', formatTipAmount(limits.min * 100, currency, lang))
    .replace('{max}', formatTipAmount(limits.max * 100, currency, lang));

  function switchCurrency(next: TipCurrency) {
    setCurrency(next);
    setAmount(String(TIP_LIMITS[next].presets[1]));
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(videoId ? '/api/videos/thanks' : '/api/live/tip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(videoId ? { videoId, amount: value, currency, message } : { channelId, amount: value, currency, message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        const code = body?.code;
        setError(
          code === 'links'
            ? t('liveChatErrLinks')
            : code === 'blocked'
              ? t('liveChatErrBlocked')
              : code === 'banned' || code === 'timeout'
                ? t('liveChatErrBanned')
                : code === 'amount'
                  ? range
                  : code === 'slow'
                    ? t('liveChatTooFast')
                    : videoId && ['not-connected', 'disabled', 'unavailable', 'missing', 'video', 'self', 'comments-off'].includes(code)
                      ? t('superThanksUnavailable')
                      : code === 'test-mode'
                        ? t('payErrTesting')
                        : t('tipFailed')
        );
        return;
      }
      window.location.href = body.url;
    } catch {
      setError(t('tipFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tip-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className="tip-dialog panel" role="dialog" aria-modal="true" aria-labelledby="tip-title">
        <div className="tip-head">
          <p id="tip-title" className="tip-title">
            💛 {(videoId ? t('superThanksTitle') : t('tipTitle')).replace('{name}', channelName)}
          </p>
          <button type="button" className="tip-close" onClick={onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
        {!loggedIn ? (
          <div className="tip-login">
            <p>{videoId ? t('superThanksLogin') : t('tipLogin')}</p>
            <Link href={`/login?next=${encodeURIComponent(videoId ? `/watch/${videoId}` : `/live/${channelId}`)}`} className="streams-btn primary">
              {t('liveChatSignIn')}
            </Link>
          </div>
        ) : (
          <form onSubmit={pay} className="tip-form">
            <div className="tip-currencies" role="radiogroup" aria-label={t('tipCurrency')}>
              {TIP_CURRENCIES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={currency === c} className={`search-chip ${currency === c ? 'active' : ''}`} onClick={() => switchCurrency(c)}>
                  {c === 'czk' ? 'Kč' : '€'}
                </button>
              ))}
            </div>
            <div className="tip-presets">
              {limits.presets.map((p) => (
                <button key={p} type="button" className={`tip-preset ${value === p ? 'active' : ''}`} onClick={() => setAmount(String(p))}>
                  {formatTipAmount(p * 100, currency, lang)}
                </button>
              ))}
            </div>
            <label className="tip-field">
              <span>{t('tipAmount')}</span>
              <input
                type="number"
                inputMode="decimal"
                min={limits.min}
                max={limits.max}
                step={currency === 'czk' ? 1 : 0.5}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={!valid}
              />
              <small className={valid ? '' : 'tip-invalid'}>{range}</small>
            </label>
            <label className="tip-field">
              <span>{t('tipMessage')}</span>
              <textarea
                rows={3}
                maxLength={TIP_MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={videoId ? t('superThanksPlaceholder') : t('tipMessagePlaceholder')}
              />
              <small>
                {message.length}/{TIP_MESSAGE_MAX} · {videoId ? t('superThanksHint') : t('tipMessageHint')}
              </small>
            </label>
            <p className="tip-note">{t('tipFeeNote').replace('{fee}', String(feePercent))}</p>
            {error && <p className="error-text">{error}</p>}
            <button type="submit" className="tip-pay" disabled={!valid || busy}>
              {busy ? t('tipOpening') : t('tipPay').replace('{amount}', valid ? formatTipAmount(currency === 'czk' ? Math.round(value) * 100 : Math.round(value * 100), currency, lang) : '')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
