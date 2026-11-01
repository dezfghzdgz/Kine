'use client';

import { useMemo, useState } from 'react';
import UiIcon from './UiIcon';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useLanguage, type Lang } from '@/lib/i18n';
import { cumulativeSeries, type SeriesRange, type TimePoint } from '@/lib/statSeries';

type Range = SeriesRange;

const DATE_LOCALES: Record<Lang, string> = {
  cs: 'cs-CZ', en: 'en-US', de: 'de-DE', sk: 'sk-SK',
  es: 'es-ES', pl: 'pl-PL', fr: 'fr-FR', uk: 'uk-UA',
};

function buildSeries(points: TimePoint[], range: Range, locale: string, todayLabel: string) {
  return cumulativeSeries(points, range).map((p) => ({
    date: p.isNow ? todayLabel : new Date(p.t).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
    count: p.count,
  }));
}

export default function StatChartModal({
  title,
  points,
  onClose,
}: {
  title: string;
  /** Události v čase s vahou (lib/statSeries.ts). */
  points: TimePoint[];
  onClose: () => void;
}) {
  const { t, lang } = useLanguage();
  const [range, setRange] = useState<Range>('all');
  const rangeLabels: Record<Range, string> = {
    all: t('rangeAll'),
    year: t('rangeYear'),
    month: t('rangeMonth'),
    week: t('rangeWeek'),
  };
  const data = useMemo(
    () => buildSeries(points, range, DATE_LOCALES[lang], t('todayLabel')),
    [points, range, lang]
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="panel modal-glass"
        style={{ width: '100%', maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <p className="panel-heading" style={{ margin: 0 }}>{title}</p>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" style={{ color: 'var(--text-faint)' }}>
            <UiIcon name="close" size={16} />
          </button>
        </div>

        <div className="tab-row">
          {(Object.keys(rangeLabels) as Range[]).map((r) => (
            <button
              key={r}
              className={`tab-btn ${range === r ? 'active' : ''}`}
              onClick={() => setRange(r)}
            >
              {rangeLabels[r]}
            </button>
          ))}
        </div>

        <div style={{ width: '100%', height: 260, marginTop: 16 }}>
          {points.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', textAlign: 'center', paddingTop: 80 }}>
              {t('noChartDataYet')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="statFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--text)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--text)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-faint)" fontSize={11} tickLine={false} />
                <YAxis stroke="var(--text-faint)" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text)' }}
                />
                <Area type="monotone" dataKey="count" stroke="var(--text)" fill="url(#statFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
