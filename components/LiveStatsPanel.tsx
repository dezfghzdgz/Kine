'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';
import { formatTipAmount } from '@/lib/liveTips';
import type { LiveSessionStats } from '@/lib/liveStats';
import UiIcon, { type UiIconName } from '@/components/UiIcon';
import FieldHint from '@/components/FieldHint';

type Stats = {
  enabled: boolean;
  hasStream: boolean;
  current: { startedAt: string | null; viewers: number | null; title: string } | null;
  sessions: LiveSessionStats[];
  totals: { sessions: number; seconds: number; peakViewers: number; chatMessages: number; tips: Record<string, { count: number; cents: number }> };
};

/** 1:05:09 / 12:04 */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * Statistiky živého vysílání (Statistiky kanálu). Data z /api/live/stats -
 * posledních 20 vysílání: délka, diváci (nejvíc / průměrně), chat a podpory.
 * Kdo nikdy nevysílal a statistiky ještě nejsou zapnuté, panel nevidí vůbec.
 */
export default function LiveStatsPanel() {
  const { t, lang } = useLanguage();
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/live/stats', { headers: await authHeaders(), cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Stats;
        if (alive) setStats(data);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="panel live-stats" style={{ marginBottom: 20 }}>
        <p className="panel-heading">{t('liveStatsTitle')}</p>
        <p className="live-stats-note">{t('liveStatsError')}</p>
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="panel live-stats" style={{ marginBottom: 20 }} aria-busy="true">
        <p className="panel-heading">{t('liveStatsTitle')}</p>
        <div className="live-stats-skeleton" />
      </div>
    );
  }
  // Statistiky ještě nejdou (bez migrace) a kanál nikdy nevysílal: panel by jen strašil.
  if (!stats.enabled && !stats.hasStream) return null;

  const locale = DATE_LOCALES[lang];
  const num = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  const tipText = (tips: Record<string, number>) =>
    Object.entries(tips)
      .filter(([, cents]) => cents > 0)
      .map(([cur, cents]) => formatTipAmount(cents, cur, locale))
      .join(' + ');
  const totalTips = Object.fromEntries(Object.entries(stats.totals.tips).map(([cur, v]) => [cur, v.cents]));
  const totalTipCount = Object.values(stats.totals.tips).reduce((n, v) => n + v.count, 0);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const kpis: { key: string; icon: UiIconName; tone: string; value: string; label: string; wide?: boolean }[] = [
    { key: 'sessions', icon: 'broadcast', tone: '#ff5a5f', value: num(stats.totals.sessions), label: t('liveStatsSessions') },
    { key: 'time', icon: 'timer', tone: '#7c8cff', value: formatDuration(stats.totals.seconds), label: t('liveStatsTime') },
    { key: 'peak', icon: 'users', tone: '#4fbf87', value: num(stats.totals.peakViewers), label: t('liveStatsPeak') },
    { key: 'chat', icon: 'chat', tone: '#f0a83c', value: num(stats.totals.chatMessages), label: t('liveStatsChat') },
  ];
  if (totalTipCount > 0) kpis.push({ key: 'tips', icon: 'coins', tone: '#e7c04b', value: tipText(totalTips), label: `${t('liveStatsTips')} (${totalTipCount})`, wide: Object.keys(totalTips).length > 1 });

  return (
    <div className="panel live-stats" style={{ marginBottom: 20 }}>
      <p className="panel-heading">
        {t('liveStatsTitle')}
        <FieldHint text={t('liveStatsHint')} />
      </p>

      {stats.current && (
        <div className="live-stats-now" role="status">
          <span className="live-stats-dot" aria-hidden="true" />
          <strong>{t('liveStatsNowLive')}</strong>
          {stats.current.viewers !== null && (
            <span className="live-stats-now-viewers">
              <UiIcon name="eye" size={14} /> {num(stats.current.viewers)}
              <span className="live-stats-sr"> {t('liveViewersNow')}</span>
            </span>
          )}
          {stats.current.startedAt && (
            <span className="live-stats-now-since">
              {formatDuration((Date.now() - Date.parse(stats.current.startedAt)) / 1000)}
            </span>
          )}
        </div>
      )}

      {stats.sessions.length === 0 ? (
        <div className="live-stats-empty">
          <p className="live-stats-note">{t('liveStatsEmpty')}</p>
          <Link href="/live" className="live-stats-cta">
            <UiIcon name="broadcast" size={15} /> {t('liveStatsGoLive')}
          </Link>
        </div>
      ) : (
        <>
          <div className="live-stats-kpis">
            {kpis.map((k) => (
              <div key={k.key} className={`live-stats-kpi${k.wide ? ' wide' : ''}`}>
                <span className="stats-kpi-icon" style={{ color: k.tone, background: `color-mix(in srgb, ${k.tone} 16%, transparent)` }} aria-hidden="true">
                  <UiIcon name={k.icon} size={17} />
                </span>
                <span className="stats-kpi-value" title={k.value}>
                  {k.value}
                </span>
                <span className="stats-kpi-label">{k.label}</span>
              </div>
            ))}
          </div>

          <div className="live-stats-table-wrap">
            <table className="live-stats-table">
              <thead>
                <tr>
                  <th scope="col">{t('liveStatsWhen')}</th>
                  <th scope="col">{t('liveStatsStream')}</th>
                  <th scope="col" className="num">{t('liveStatsDuration')}</th>
                  <th scope="col" className="num">{t('liveStatsPeak')}</th>
                  <th scope="col" className="num">{t('liveStatsAvg')}</th>
                  <th scope="col" className="num">{t('liveStatsChat')}</th>
                  <th scope="col" className="num">{t('liveStatsTips')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="when">{when(s.startedAt)}</td>
                    <td className="title" title={s.title || t('liveStatsUntitled')}>
                      {s.title || <span className="muted">{t('liveStatsUntitled')}</span>}
                    </td>
                    <td className="num">{formatDuration(s.durationS)}</td>
                    <td className="num">{num(s.peakViewers)}</td>
                    <td className="num">{s.avgViewers === null ? '–' : num(s.avgViewers)}</td>
                    <td className="num">{s.chatMessages === null ? '–' : num(s.chatMessages)}</td>
                    <td className="num">{s.tips && s.tips.count > 0 ? tipText(s.tips.byCurrency) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
