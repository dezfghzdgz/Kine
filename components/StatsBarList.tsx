'use client';

/**
 * Vodorovný žebříček - "kolik čeho" seřazené odshora dolů.
 *
 * Používá se hlavně na zdroje zhlédnutí ("odkud diváci přišli"). Je to jedna
 * jediná řada čísel, takže všechny pruhy mají stejnou barvu - obarvovat je
 * podle hodnoty by jen znovu říkalo to, co už říká délka pruhu.
 */

export type BarItem = { key: string; label: string; value: number };

export default function StatsBarList({
  items,
  emptyNote = 'Zatím nejsou data.',
  maxRows = 8,
  valueSuffix = '',
}: {
  items: BarItem[];
  emptyNote?: string;
  maxRows?: number;
  valueSuffix?: string;
}) {
  const total = items.reduce((sum, i) => sum + i.value, 0);

  if (total === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>{emptyNote}</p>;
  }

  const sorted = [...items].sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, maxRows);
  const restValue = sorted.slice(maxRows).reduce((sum, i) => sum + i.value, 0);

  // Zbytek se nikdy nezamlčí - slije se do jednoho řádku "Ostatní", ať
  // součet pořád sedí na 100 %.
  const rows = restValue > 0
    ? [...shown, { key: '__rest', label: 'Ostatní', value: restValue }]
    : shown;

  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((row) => {
        const share = (row.value / total) * 100;
        return (
          <div key={row.key} title={`${row.label}: ${row.value}${valueSuffix} (${share.toFixed(1)} %)`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 3 }}>
              <span
                style={{
                  fontSize: 12.5, color: 'var(--text-dim)', minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-faint)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(share)}% · {row.value}{valueSuffix}
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--panel-raised)', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `max(${(row.value / max) * 100}%, 3px)`,
                  height: '100%',
                  background: 'var(--brand)',
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
