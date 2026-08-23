'use client';

import { useMemo, useState } from 'react';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { videoCountLabel } from '@/lib/plural';

/**
 * Kalendář zhlédnutých videí.
 *
 * Schovaný pod tlačítkem 📅 v Aktivitě - normálně jsou videa jen rozdělená
 * po dnech, a kdo v tom chce hledat, otevře si kalendář a klikne na
 * konkrétní den. Dny, kdy se nic nedívalo, jsou neaktivní; u dnů s videi je
 * vidět kolik jich ten den bylo, ať jde poznat, kde stojí za to se podívat.
 *
 * Názvy dnů a měsíců se berou z prohlížeče podle zvoleného jazyka, takže
 * kalendář mluví stejnou řečí jako zbytek appky.
 */

/** Klíč dne ve tvaru 2026-08-22 (podle místního času, ne UTC). */
export function dayKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

export default function WatchCalendar({
  countsByDay,
  selectedDay,
  onSelectDay,
}: {
  /** Kolik videí padlo na který den, klíč = 2026-08-22 */
  countsByDay: Record<string, number>;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
}) {
  const { t, lang } = useLanguage();
  const locale = DATE_LOCALES[lang];

  // Kalendář se otevírá na měsíci, ve kterém je vybraný den - jinak na
  // nejnovějším měsíci, kdy uživatel něco sledoval, a jako poslední
  // možnost na dnešku.
  const [cursor, setCursor] = useState(() => {
    if (selectedDay) return new Date(`${selectedDay}T00:00:00`);
    const days = Object.keys(countsByDay).sort();
    const latest = days[days.length - 1];
    return latest ? new Date(`${latest}T00:00:00`) : new Date();
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Zkratky dnů od pondělí, v jazyce uživatele. 5. 1. 2026 bylo pondělí.
  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => formatter.format(new Date(2026, 0, 5 + i)));
  }, [locale]);

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)),
    [locale, year, month]
  );

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay(): neděle = 0. U nás týden začíná pondělím, proto posun.
    const leading = (first.getDay() + 6) % 7;

    const list: (number | null)[] = [];
    for (let i = 0; i < leading; i++) list.push(null);
    for (let d = 1; d <= daysInMonth; d++) list.push(d);
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [year, month]);

  const monthTotal = useMemo(() => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    return Object.entries(countsByDay)
      .filter(([key]) => key.startsWith(prefix))
      .reduce((sum, [, n]) => sum + n, 0);
  }, [countsByDay, year, month]);

  const todayKey = dayKey(new Date());

  return (
    <div className="panel" style={{ marginBottom: 20, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="calendar-nav-btn"
          aria-label={t('calendarPrevMonth')}
        >
          ‹
        </button>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, textTransform: 'capitalize' }}>{monthLabel}</p>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-faint)' }}>
            {monthTotal > 0
              ? t('calendarWatchedVideos').replace('{count}', String(monthTotal))
              : t('calendarNothingThisMonth')}
          </p>
        </div>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="calendar-nav-btn"
          aria-label={t('calendarNextMonth')}
        >
          ›
        </button>
      </div>

      <div className="calendar-grid">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="calendar-weekday">{w}</div>
        ))}

        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;

          const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const count = countsByDay[key] ?? 0;
          const isSelected = selectedDay === key;

          return (
            <button
              key={key}
              type="button"
              disabled={count === 0}
              onClick={() => onSelectDay(isSelected ? null : key)}
              className={`calendar-day ${isSelected ? 'selected' : ''} ${key === todayKey ? 'today' : ''}`}
              title={
                count > 0
                  ? videoCountLabel(count, lang, t)
                  : t('calendarNothingWatched')
              }
            >
              <span>{day}</span>
              {count > 0 && <span className="calendar-day-count">{count > 9 ? '9+' : count}</span>}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <button
          onClick={() => onSelectDay(null)}
          style={{
            marginTop: 12, background: 'var(--panel-raised)', color: 'var(--text)',
            fontSize: 12, padding: '6px 12px', width: '100%',
          }}
        >
          {t('calendarClearDayFilter')}
        </button>
      )}
    </div>
  );
}
