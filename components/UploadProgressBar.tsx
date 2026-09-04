'use client';

import Link from 'next/link';
import { useUploadCommands, useUploadState } from '@/lib/uploadManager';
import { useLanguage } from '@/lib/i18n';

/**
 * Proužek nahrávání, který jde s tvůrcem po celé appce.
 *
 * Nahrávání teď běží v kostře appky (lib/uploadManager.tsx), takže se dá
 * mezitím normálně koukat na videa. Aby ale nebylo neviditelné, drží se
 * tenhle proužek dole nad lištou a ukazuje, jak to jde - a když je
 * hotovo, dá odkaz na video.
 */
export default function UploadProgressBar() {
  const { phase, percent, title, videoId, error, failedInvites } = useUploadState();
  const { dismiss } = useUploadCommands();
  const { t } = useLanguage();

  if (phase === 'idle') return null;

  const popis =
    phase === 'uploading'
      ? `${t('uploadingLabel')} ${percent}%`
      : phase === 'saving'
        ? t('savingLabel')
        : phase === 'processing'
          ? t('processingLabel')
          : phase === 'done'
            ? t('uploadDoneLabel')
            : t('uploadFailedLabel');

  return (
    <div className={`upload-bar upload-bar-${phase}`} role="status" aria-live="polite">
      <div className="upload-bar-body">
        <p className="upload-bar-title">{title || t('uploadTitle')}</p>
        <p className="upload-bar-status">
          {popis}
          {error ? ` · ${error}` : ''}
          {failedInvites ? ` · ${failedInvites.names.join(', ')}` : ''}
        </p>

        {phase === 'uploading' && (
          <div className="upload-bar-track">
            <div className="upload-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>

      <div className="upload-bar-actions">
        {phase === 'done' && videoId && (
          <Link href={`/watch/${videoId}`} className="upload-bar-link">
            {t('uploadOpenVideo')}
          </Link>
        )}
        {(phase === 'done' || phase === 'error') && (
          <button type="button" className="upload-bar-close" onClick={dismiss} aria-label={t('close')}>
            ×
          </button>
        )}
      </div>
    </div>
  );
}
