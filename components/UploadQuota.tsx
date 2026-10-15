'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { formatDuration } from '@/lib/uploadLimits';

type Summary = {
  tier: 'staff' | 'plus' | 'free' | 'new';
  maxVideoSeconds: number;
  perDay: number;
  uploadsToday: number;
  secondsPerDay: number;
  secondsToday: number;
  storageSeconds: number;
  storedSeconds: number;
  /** Klipy (videa do clipMaxSeconds) - nový účet je má zvlášť (novější server). */
  clipsPerDay?: number;
  clipMaxSeconds?: number;
  paused?: boolean;
};

/**
 * Limity nahrávání na stránce nahrávání (lib/uploadLimits.ts): kolik videí
 * ještě dnes, jak dlouhé smí být a kolik místa zbývá. Na moc dlouhé video
 * upozorní hned po výběru souboru - ne až po čtvrthodině nahrávání.
 */
export default function UploadQuota({
  durationSeconds,
  onTooLong,
}: {
  durationSeconds?: number | null;
  /** Hláška o moc dlouhém videu (null = v pořádku) - stránka pak nepustí dál. */
  onTooLong?: (message: string | null) => void;
}) {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch('/api/videos/upload-limits', { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json().catch(() => null)) as Summary | null;
      if (!cancelled && body && Number.isFinite(body.maxVideoSeconds)) setSummary(body);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tooLongMessage =
    summary && summary.tier !== 'staff' && typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > summary.maxVideoSeconds + 1
      ? t('uploadQuotaTooLong').replace('{length}', formatDuration(durationSeconds, 'up')).replace('{max}', formatDuration(summary.maxVideoSeconds))
      : null;

  useEffect(() => {
    onTooLong?.(tooLongMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tooLongMessage]);

  if (!summary || summary.tier === 'staff') return null;

  const left = Math.max(0, summary.perDay - summary.uploadsToday);

  return (
    <div className="upload-quota" role="status">
      {summary.paused && <p className="upload-quota-warn">{t('uploadPausedNote')}</p>}
      {tooLongMessage && <p className="upload-quota-warn">{tooLongMessage}</p>}
      <p>
        {t('uploadQuotaToday')
          .replace('{left}', String(left))
          .replace('{perDay}', String(summary.perDay))
          .replace('{max}', formatDuration(summary.maxVideoSeconds))}
        {summary.storageSeconds > 0 && (
          <>
            {' · '}
            {t('uploadQuotaStorage').replace('{used}', formatDuration(summary.storedSeconds)).replace('{total}', formatDuration(summary.storageSeconds))}
          </>
        )}
      </p>
      {summary.tier === 'new' && (
        <p className="upload-quota-note">
          {t('uploadQuotaNewAccount')
            .replace('{max}', formatDuration(summary.maxVideoSeconds))
            .replace('{perDay}', String(summary.perDay))
            .replace('{clips}', String(summary.clipsPerDay ?? summary.perDay))
            .replace('{clipMax}', formatDuration(summary.clipMaxSeconds ?? 300))}
        </p>
      )}
    </div>
  );
}
