'use client';

import { useMemo } from 'react';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';

/**
 * Kdy se lidi dívají - mřížka 7 dní x 24 hodin.
 *
 * Každé políčko je jedna hodina jednoho dne v týdnu a jeho sytost říká,
 * kolik zhlédnutí v ní padlo. Je to jedno jediné měřítko "málo -> hodně",
 * takže barva je pořád stejná (značková) a mění se jen sytost - žádná
 * duha, ve které by nešlo poznat, co je víc.
 */

export default function StatsHeatmap({
  /** counts[den 0-6 od pondělí][hodina 0-23] */
  counts,
}: {
  counts: number[][];
}) {
  const { t, lang } = useLanguage();
  const locale = DATE_LOCALES[lang];

  // Zkratky dnů od pondělí, v jazyce uživatele. 5. 1. 2026 bylo pondělí.
  const dayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2026, 0, 5 + i)));
  }, [locale]);

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
        {t('heatmapNotEnough')}
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 12px' }}>
        {t('heatmapPeak')}{' '}
        <strong style={{ color: 'var(--text)' }}>
          {dayLabels[best.day]} {best.hour}:00
        </strong>{' '}
        <span style={{ color: 'var(--text-faint)' }}>
          {t('heatmapViewsCount').replace('{count}', String(best.value))}
        </span>
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
              <span className="heatmap-day-label">{dayLabels[day]}</span>
              {row.map((value, hour) => (
                <span
                  key={hour}
                  className="heatmap-cell"
                  title={t('heatmapCellTitle')
                    .replace('{day}', dayLabels[day])
                    .replace(/\{hour\}/g, String(hour))
                    .replace('{count}', String(value))}
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
        <span>{t('heatmapLess')}</span>
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
        <span>{t('heatmapMore')}</span>
      </div>
    </div>
  );
}
