'use client';

import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

type Range = 'all' | 'year' | 'month' | 'week';

const RANGE_LABELS: Record<Range, string> = {
  all: 'Od začátku',
  year: 'Poslední rok',
  month: 'Poslední měsíc',
  week: 'Poslední týden',
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
  const [range, setRange] = useState<Range>('all');

  const data = useMemo(() => {
    if (history.length === 0) return [];
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const earliest = new Date(sorted[0].date);
    const start = rangeStartDate(range, earliest);

    return sorted
      .filter((h) => new Date(h.date) >= start)
      .map((h) => ({
        date: new Date(h.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' }),
        score: h.score,
      }));
  }, [history, range]);

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
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <button
              key={r}
              className={`tab-btn ${range === r ? 'active' : ''}`}
              onClick={() => setRange(r)}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        <div style={{ width: '100%', height: 260, marginTop: 16 }}>
          {data.length < 2 ? (
            <p style={{ color: 'var(--text-faint)', textAlign: 'center', paddingTop: 80 }}>
              Zatím málo dat na graf - vrať se za pár dní.
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
