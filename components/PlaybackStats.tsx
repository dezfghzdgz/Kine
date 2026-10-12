'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { fragmentKbps, mbps, qualityLabel, statsReport, vodVerdict, type FragmentSample } from '@/lib/vodPlayerCore';
import type { VodStats } from '@/lib/vodPlayer';

/** Kolik vteřin videa je stažených dopředu od místa přehrávání. */
export function bufferedAhead(video: HTMLVideoElement | null): number | null {
  if (!video) return null;
  const t = video.currentTime;
  const b = video.buffered;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= t + 0.25 && t <= b.end(i)) return Math.max(0, b.end(i) - t);
  }
  return 0;
}

/**
 * Statistiky přehrávání (jako "Statistiky pro nerdy" na YouTube): proč se
 * video načítá pomalu - Cloudflare, nebo připojení. Otevírá se v nabídce
 * přehrávače (⋮) nebo adresou s ?stats=1. "Kopírovat" dá technický souhrn
 * do schránky (stejný jde do /admin/errors, když se video rozjíždí pomalu).
 */
export default function PlaybackStats({
  stats,
  video,
  videoId,
  durationS,
  startAt,
  onClose,
}: {
  /** null = hraje iframe Cloudflare (dovnitř se nevidí). */
  stats: VodStats | null;
  video: HTMLVideoElement | null;
  videoId: string;
  durationS: number | null;
  startAt: number | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [, setTick] = useState(0);
  const [copied, setCopied] = useState(false);

  // Statistiky se mění pod rukama (načítání kusů) - panel se překresluje každou vteřinu.
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const ahead = bufferedAhead(video);
  const verdict = stats ? vodVerdict(stats) : null;
  const sample = (f: FragmentSample) =>
    `${qualityLabel(f.height)} · ${t('playerStatsTtfb').replace('{ms}', String(f.ttfbMs))} · ${(f.kb / 1024).toFixed(1)} MB / ${(f.loadMs / 1000).toFixed(1)} s`;

  async function copy() {
    const text = stats
      ? statsReport(stats, {
          videoId,
          durationS,
          startAt,
          bufferedAheadS: ahead,
          waitedMs: typeof performance !== 'undefined' ? performance.now() - stats.attachedAt : null,
        })
      : `engine=cloudflare-iframe video=${videoId}`;
    try {
      await navigator.clipboard.writeText(`${text}\nua=${navigator.userAgent}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Schránka nejde (starší prohlížeč) - nic se neděje.
    }
  }

  const rows: [string, string][] = stats
    ? [
        [t('playerStatsEngine'), stats.engine === 'native' ? t('playerStatsEngineSafari') : t('playerStatsEngineKine')],
        [t('playerStatsQuality'), stats.height ? `${qualityLabel(stats.height)}${stats.bitrateKbps ? ` · ${mbps(stats.bitrateKbps)} Mb/s` : ''}` : '–'],
        [t('playerStatsBandwidth'), stats.bandwidthKbps ? `${mbps(stats.bandwidthKbps)} Mb/s` : fragmentKbps(stats.firstFragment) ? `${mbps(fragmentKbps(stats.firstFragment))} Mb/s` : '–'],
        [t('playerStatsBuffer'), ahead !== null ? `${ahead.toFixed(1)} s` : '–'],
        [t('playerStatsStart'), stats.firstFrameMs !== null ? `${(stats.firstFrameMs / 1000).toFixed(1)} s` : t('playerStatsWaiting')],
        [t('playerStatsManifest'), stats.manifestMs !== null ? `${stats.manifestMs} ms` : '–'],
        [t('playerStatsFirstChunk'), stats.firstFragment ? sample(stats.firstFragment) : '–'],
        [t('playerStatsStalls'), `${stats.stalls} · ${t('playerStatsRetries')} ${stats.retries}`],
      ]
    : [[t('playerStatsEngine'), t('playerStatsEngineCloudflare')]];

  const verdictText =
    verdict === 'ok'
      ? t('playerStatsVerdictOk')
      : verdict === 'slow-server'
        ? t('playerStatsVerdictServer')
        : verdict === 'slow-connection'
          ? t('playerStatsVerdictConnection').replace('{mbps}', mbps(stats?.bandwidthKbps ?? fragmentKbps(stats?.firstFragment)))
          : null;

  return (
    <div className="playback-stats" role="dialog" aria-label={t('playerStatsTitle')} onClick={(e) => e.stopPropagation()}>
      <div className="playback-stats-head">
        <strong>{t('playerStatsTitle')}</strong>
        <span className="playback-stats-actions">
          <button type="button" className="playback-stats-copy" onClick={copy}>
            {copied ? t('playerStatsCopied') : t('playerStatsCopy')}
          </button>
          <button type="button" className="playback-stats-close" onClick={onClose} aria-label={t('close')} title={t('close')}>
            ×
          </button>
        </span>
      </div>
      {/* Verdikt hned nahoře - v malém přehrávači by se pod řádky už nevešel. */}
      {verdictText && <p className={`playback-stats-verdict playback-stats-verdict-${verdict}`}>{verdictText}</p>}
      {!stats && <p className="playback-stats-verdict">{t('playerStatsIframeNote')}</p>}
      <dl className="playback-stats-rows">
        {rows.map(([label, value]) => (
          <div key={label} className="playback-stats-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {stats && stats.recent.length > 1 && (
        <div className="playback-stats-recent">
          <span>{t('playerStatsRecent')}</span>
          {stats.recent.slice(-3).map((f, i) => (
            <code key={i}>{sample(f)}</code>
          ))}
        </div>
      )}
    </div>
  );
}
