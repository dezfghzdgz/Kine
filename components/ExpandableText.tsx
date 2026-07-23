'use client';

import { useState } from 'react';

export default function ExpandableText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 160;
  const shown = expanded || !isLong ? text : text.slice(0, 160) + '…';

  return (
    <div style={{ marginTop: 16, color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.5 }}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{shown}</p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none', border: 'none', color: 'var(--text)', padding: 0,
            fontSize: 13, fontWeight: 600, marginTop: 6, cursor: 'pointer',
          }}
        >
          {expanded ? 'Zobrazit méně' : 'Zobrazit více'}
        </button>
      )}
    </div>
  );
}
