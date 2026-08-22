'use client';

/**
 * Rozložení hvězdiček jako procentuální graf.
 *
 * Dřív se u videa ukazovaly jen holé pruhy, takže když všichni dali stejné
 * hodnocení, jeden pruh byl "vymaxovaný" na celou šířku a z grafu nešlo nic
 * vyčíst. Teď je u každé úrovně vidět, kolik procent hodnocení na ni padlo
 * i kolik jich přesně bylo, a nahoře průměr s celkovým počtem - takže je
 * hned poznat, jestli je plný pruh z jednoho hlasu, nebo ze sta.
 */

// Hodnocení má dva póly (špatné vs. dobré) a neutrální střed, takže barvy
// jdou od červené přes šedou k zelené - ne duhou. Šedá trojka čtenáři
// říká "ani ryba ani rak" sama od sebe.
const STAR_COLORS = ['#d64550', '#e08a72', '#8a8a8f', '#6fbf87', '#2fa36b'];

export default function StarDistribution({
  distribution,
  compact = false,
  showSummary = true,
}: {
  /** Počty hodnocení, index 0 = 1★ ... index 4 = 5★ */
  distribution: number[];
  compact?: boolean;
  showSummary?: boolean;
}) {
  const dist = [0, 1, 2, 3, 4].map((i) => distribution[i] ?? 0);
  const total = dist.reduce((sum, n) => sum + n, 0);

  if (total === 0) {
    return (
      <p style={{ fontSize: compact ? 11.5 : 13, color: 'var(--text-faint)', margin: 0 }}>
        Zatím bez hodnocení
      </p>
    );
  }

  const average = dist.reduce((sum, n, i) => sum + n * (i + 1), 0) / total;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 5 }}>
      {showSummary && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: compact ? 15 : 22, fontWeight: 700 }}>{average.toFixed(1)}</span>
          <span style={{ fontSize: compact ? 11 : 13, color: 'var(--text-faint)' }}>
            / 5 · {total} hodnocení
          </span>
        </div>
      )}

      {[5, 4, 3, 2, 1].map((stars) => {
        const count = dist[stars - 1];
        const pct = (count / total) * 100;

        return (
          <div key={stars} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: compact ? 10.5 : 11.5,
                color: 'var(--text-faint)',
                width: 22,
                flexShrink: 0,
                textAlign: 'right',
              }}
            >
              {stars}★
            </span>

            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: compact ? 6 : 9,
                background: 'var(--panel-raised)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  // Šířka pruhu = přesně tolik procent, kolik hodnocení
                  // na tuhle úroveň padlo. Nenulová hodnota má vždycky
                  // aspoň tenký proužek, ať není vidět "nula".
                  width: count > 0 ? `max(${pct}%, 3px)` : 0,
                  height: '100%',
                  background: STAR_COLORS[stars - 1],
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <span
              style={{
                fontSize: compact ? 10.5 : 11.5,
                color: 'var(--text-faint)',
                width: compact ? 62 : 72,
                flexShrink: 0,
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pct.toFixed(pct > 0 && pct < 1 ? 1 : 0)}% ({count})
            </span>
          </div>
        );
      })}
    </div>
  );
}
