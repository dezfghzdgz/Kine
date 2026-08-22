'use client';

import { useMemo } from 'react';

/**
 * Kdy se lidi dívají - mřížka 7 dní x 24 hodin.
 *
 * Každé políčko je jedna hodina jednoho dne v týdnu a jeho sytost říká,
 * kolik zhlédnutí v ní padlo. Je to jedno jediné měřítko "málo -> hodně",
 * takže barva je pořád stejná (značková) a mění se jen sytost - žádná
 * duha, ve které by nešlo poznat, co je víc.
 */

const DAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

export default function StatsHeatmap({
  /** counts[den 0-6 od pondělí][hodina 0-23] */
  counts,
}: {
  counts: number[][];
}) {
  const { max, total, best } = useMemo(() => {
    let max = 0;
    let total = 0;
    let best = { day: 0, hour: 0, value: 0 };

    counts.forEach((row, day) =>
      row.forEach((value, hour) => {
        total += value;
        if (value > max) max = value;
        if (value > best.value) best = { day, hour, value };
      })
    );

    return { max, total, best };
  }, [counts]);

  if (total === 0) {
    return (
      <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
        Zatím není dost zhlédnutí, aby z toho šlo něco vyčíst.
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 12px' }}>
        Nejvíc se lidi dívají <strong style={{ color: 'var(--text)' }}>
          {DAY_LABELS[best.day]} v {best.hour}:00
        </strong>{' '}
        <span style={{ color: 'var(--text-faint)' }}>({best.value} zhlédnutí)</span>
      </p>

      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 560 }}>
          {/* Popisky hodin - kvůli místu jen každá třetí. */}
          <div className="heatmap-row">
            <span className="heatmap-day-label" />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="heatmap-hour-label">
                {hour % 3 === 0 ? hour : ''}
              </span>
            ))}
          </div>

          {counts.map((row, day) => (
            <div key={day} className="heatmap-row">
              <span className="heatmap-day-label">{DAY_LABELS[day]}</span>
              {row.map((value, hour) => (
                <span
                  key={hour}
                  className="heatmap-cell"
                  title={`${DAY_LABELS[day]} ${hour}:00–${hour}:59 · ${value} zhlédnutí`}
                  style={{
                    // Sytost = podíl na nejsilnější hodině. Odmocnina
                    // zvedne slabá políčka, ať nejsou úplně neviditelná.
                    opacity: value === 0 ? 1 : 0.18 + 0.82 * Math.sqrt(value / max),
                    background: value === 0 ? 'var(--panel-raised)' : 'var(--brand)',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="heatmap-legend">
        <span>méně</span>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <span
            key={step}
            className="heatmap-cell heatmap-legend-cell"
            style={{
              background: step === 0 ? 'var(--panel-raised)' : 'var(--brand)',
              opacity: step === 0 ? 1 : 0.18 + 0.82 * step,
            }}
          />
        ))}
        <span>více</span>
      </div>
    </div>
  );
}
