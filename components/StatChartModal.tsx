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

function buildSeries(timestamps: Date[], range: Range) {
  if (timestamps.length === 0) return [];
  const sorted = [...timestamps].sort((a, b) => a.getTime() - b.getTime());
  const earliest = sorted[0];
  const start = rangeStartDate(range, earliest);
  const now = new Date();

  const bucketDays = range === 'week' ? 1 : range === 'month' ? 1 : range === 'year' ? 7 : 30;
  const points: { date: string; count: number }[] = [];

  let cursor = new Date(start);
  while (cursor <= now) {
    const cumulativeCount = sorted.filter((t) => t <= cursor).length;
    points.push({
      date: cursor.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' }),
      count: cumulativeCount,
    });
    cursor = new Date(cursor.getTime() + bucketDays * 24 * 60 * 60 * 1000);
  }

  const finalCount = sorted.filter((t) => t <= now).length;
  points.push({ date: 'dnes', count: finalCount });

  return points;
}

export default function StatChartModal({
  title,
  timestamps,
  onClose,
}: {
  title: string;
  timestamps: Date[];
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>('all');
  const data = useMemo(() => buildSeries(timestamps, range), [timestamps, range]);

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
          <p className="panel-heading" style={{ margin: 0 }}>{title}</p>
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
          {timestamps.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', textAlign: 'center', paddingTop: 80 }}>
              Zatím žádná data k zobrazení.
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
