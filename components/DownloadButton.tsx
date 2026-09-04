'use client';

import { useState } from 'react';
import { DownloadIcon } from './ReactionIcons';
import { useLanguage } from '@/lib/i18n';
import { startDownload, recordDownload } from '@/lib/download';

export default function DownloadButton({
  videoId,
  cloudflareVideoId,
  label,
}: {
  videoId: string;
  cloudflareVideoId: string;
  /** Jiný text tlačítka. V historii stažení je to "Stáhnout znovu". */
  label?: string;
}) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Připravený soubor, na který si uživatel musí kliknout sám. Vzniká
  // tehdy, když příprava trvala dýl než okamžik po kliknutí a prohlížeč
  // by novou kartu zablokoval.
  const [readyUrl, setReadyUrl] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);
    setReadyUrl(null);

    const outcome = await startDownload(videoId, cloudflareVideoId);
    setLoading(false);

    switch (outcome.kind) {
      case 'opened':
        return;
      case 'link':
        setReadyUrl(outcome.url);
        return;
      case 'needs-login':
        setError(t('downloadNeedsLogin'));
        return;
      case 'not-ready':
        setError(t('menuDownloadNotReady'));
        return;
      case 'failed':
        setError(outcome.message || t('menuActionFailed'));
        return;
    }
  }

  return (
    <div>
      {readyUrl ? (
        // Do historie se zapíše až teď - dřív se zapisovalo hned po
        // získání adresy, takže "Stažené" obsahovalo i videa, u kterých
        // prohlížeč stahování vůbec nepustil.
        <a
          className="reaction-btn download-ready-link"
          href={readyUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => recordDownload(videoId)}
        >
          <DownloadIcon size={16} /> {t('downloadOpenFile')}
        </a>
      ) : (
        <button
          className="reaction-btn"
          onClick={handleDownload}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {loading ? t('downloadPreparing') : <><DownloadIcon size={16} /> {label ?? t('downloadButton')}</>}
        </button>
      )}
      {error && <p className="error-text" style={{ marginTop: 4 }}>{error}</p>}
    </div>
  );
}
