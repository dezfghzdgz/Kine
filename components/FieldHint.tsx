'use client';

import { useEffect, useRef, useState } from 'react';

export default function FieldHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          width: 16, height: 16, borderRadius: '50%', background: 'var(--panel-raised)',
          color: 'var(--text-faint)', border: '1px solid var(--border)', fontSize: 10,
          padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1, cursor: 'pointer', verticalAlign: 'middle',
        }}
      >
        ?
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, width: 220, zIndex: 30,
            background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 10, fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
