'use client';

import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useLanguage, type Lang } from '@/lib/i18n';

type Range = 'all' | 'year' | 'month' | 'week';

const DATE_LOCALES: Record<Lang, string> = {
  cs: 'cs-CZ', en: 'en-US', de: 'de-DE', sk: 'sk-SK',
  es: 'es-ES', pl: 'pl-PL', fr: 'fr-FR', uk: 'uk-UA',
};

function rangeStartDate(range: Range, earliest: Date): Date {
  const now = new Date();
  if (range === 'week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (range === 'month') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (range === 'year') return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  return earliest;
}

export default function RatingChartModal({
  history,
  onClose,
}: {
  history: { date: string; score: number }[];
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

  const data = useMemo(() => {
    if (history.length === 0) return [];
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const earliest = new Date(sorted[0].date);
    const start = rangeStartDate(range, earliest);

    return sorted
      .filter((h) => new Date(h.date) >= start)
      .map((h) => ({
        date: new Date(h.date).toLocaleDateString(DATE_LOCALES[lang], { day: 'numeric', month: 'short' }),
        score: h.score,
      }));
  }, [history, range, lang]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: '100%', maxWidth: 640, background: 'var(--panel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <p className="panel-heading" style={{ margin: 0 }}>Rating</p>
          <button onClick={onClose} style={{ background: 'none', color: 'var(--text-faint)', padding: 4 }}>✕</button>
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
          {data.length < 2 ? (
            <p style={{ color: 'var(--text-faint)', textAlign: 'center', paddingTop: 80 }}>
              {t('notEnoughRatingDataNote')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--text)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--text)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="var(--text-faint)" fontSize={11} tickLine={false} />
                <YAxis stroke="var(--text-faint)" fontSize={11} tickLine={false} domain={[50, 100]} />
                <Tooltip
                  contentStyle={{ background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text)' }}
                />
                <Area type="monotone" dataKey="score" stroke="var(--text)" fill="url(#ratingFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
