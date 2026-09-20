'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { formatTime } from '@/lib/playerControls';
import { biggestDrop, retentionCurve, retentionSummary, RETENTION_MIN_VIEWERS, type RetentionPoint } from '@/lib/retention';

type VideoOption = { id: string; title: string; duration_seconds: number | null; views?: number | null };

/**
 * Křivka udržení diváků (statistiky kanálu).
 *
 * Tvůrce si vybere video a vidí, jaký podíl diváků se dostal do které
 * části - a kde odpadají nejvíc. Pozice bere z creator_video_progress
 * (supabase-migration-udrzeni.sql): jen čísla, bez toho, kdo to byl.
 * Výpočet je v lib/retention.ts a má test; tady se jen kreslí (SVG,
 * bez knihovny - je to jedna čára).
 */
export default function StatsRetention({ videos }: { videos: VideoOption[] }) {
  const { t } = useLanguage();
  const [videoId, setVideoId] = useState<string>('');
  const [points, setPoints] = useState<RetentionPoint[] | null>(null);
  const [viewers, setViewers] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');

  // Výchozí: nejsledovanější video s délkou.
  useEffect(() => {
    if (videoId || videos.length === 0) return;
    const candidates = videos.filter((v) => (v.duration_seconds ?? 0) > 0);
    const best = [...candidates].sort((a, b) => (b.views ?? 0) - (a.views ?? 0))[0] ?? candidates[0];
    if (best) setVideoId(best.id);
  }, [videos, videoId]);

  const video = useMemo(() => videos.find((v) => v.id === videoId) ?? null, [videos, videoId]);

  useEffect(() => {
    if (!video) return;
    let cancelled = false;
    setState('loading');
    supabase
      .rpc('creator_video_progress', { video: video.id })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Migrace ještě neproběhla - křivka se prostě neukáže.
          setState('unavailable');
          return;
        }
        const rows = (data ?? []) as { progress_seconds: number | null; completed: boolean | null }[];
        setViewers(rows.length);
        setPoints(retentionCurve(rows, video.duration_seconds ?? 0));
        setState('ready');
      });
    return () => {
      cancelled = true;
    };
  }, [video?.id, video?.duration_seconds]);

  if (state === 'unavailable' || videos.length === 0) return null;

  const summary = points ? retentionSummary(points) : null;
  const drop = points ? biggestDrop(points) : null;
  const duration = video?.duration_seconds ?? 0;

  // Graf: 100 % nahoře, konec videa vpravo. Plocha pod čárou je jemně
  // vybarvená, ať je vidět "kolik diváků zbylo".
  const W = 600;
  const H = 160;
  const PAD = { l: 34, r: 10, t: 10, b: 24 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const coords = (points ?? []).map((p, i, arr) => {
    const x = PAD.l + (arr.length > 1 ? (i / (arr.length - 1)) * iw : 0);
    const y = PAD.t + (1 - p.share) * ih;
    return { x, y };
  });
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = coords.length > 0
    ? `${line} L${coords[coords.length - 1].x.toFixed(1)},${(PAD.t + ih).toFixed(1)} L${coords[0].x.toFixed(1)},${(PAD.t + ih).toFixed(1)} Z`
    : '';

  return (
    <div className="stats-retention">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={videoId} onChange={(e) => setVideoId(e.target.value)} style={{ fontSize: 13, maxWidth: '100%' }}>
          {videos.map((v) => (
            <option key={v.id} value={v.id} disabled={!(v.duration_seconds ?? 0)}>
              {v.title}
            </option>
          ))}
        </select>
        {state === 'ready' && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            {t('retentionViewers').replace('{count}', String(viewers))}
          </span>
        )}
      </div>

      {state === 'loading' && <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>{t('loading')}</p>}

      {state === 'ready' && (viewers < RETENTION_MIN_VIEWERS || !points || points.length === 0) && (
        <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
          {t('retentionTooFew').replace('{min}', String(RETENTION_MIN_VIEWERS))}
        </p>
      )}

      {state === 'ready' && points && points.length > 0 && viewers >= RETENTION_MIN_VIEWERS && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="stats-retention-chart" role="img" aria-label={t('retentionTitle')}>
            {[1, 0.5, 0].map((share) => {
              const y = PAD.t + (1 - share) * ih;
              return (
                <g key={share}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="stats-retention-grid" />
                  <text x={PAD.l - 6} y={y + 4} textAnchor="end" className="stats-retention-label">
                    {Math.round(share * 100)}%
                  </text>
                </g>
              );
            })}
            <path d={area} className="stats-retention-area" />
            <path d={line} className="stats-retention-line" />
            {drop && drop.drop >= 0.1 && (() => {
              const i = points.findIndex((p) => p.at === drop.at);
              const c = coords[i];
              return c ? <circle cx={c.x} cy={c.y} r={4} className="stats-retention-drop" /> : null;
            })()}
            <text x={PAD.l} y={H - 6} className="stats-retention-label">0:00</text>
            <text x={PAD.l + iw / 2} y={H - 6} textAnchor="middle" className="stats-retention-label">{formatTime(duration / 2)}</text>
            <text x={W - PAD.r} y={H - 6} textAnchor="end" className="stats-retention-label">{formatTime(duration)}</text>
          </svg>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-dim)', marginTop: 8 }}>
            {summary && (
              <>
                <span>{t('retentionHalf').replace('{percent}', String(Math.round(summary.half * 100)))}</span>
                <span>{t('retentionEnd').replace('{percent}', String(Math.round(summary.end * 100)))}</span>
              </>
            )}
            {drop && drop.drop >= 0.1 && (
              <span>
                {t('retentionDrop')
                  .replace('{time}', formatTime(drop.at))
                  .replace('{percent}', String(Math.round(drop.drop * 100)))}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
