'use client';

import { useEffect, useRef, useState } from 'react';

const EMOJIS = [
  '😀', '😂', '🥲', '😍', '😎', '🤔', '😢', '😭', '😡', '🥳',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '💯', '✨', '⭐',
  '❤️', '💔', '😱', '😴', '🤯', '🥶', '🤣', '😅', '😉', '🤩',
  '👀', '💀', '🎉', '✅', '❌', '🤝', '🫶', '😏', '🙄', '😬',
];

export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}
        aria-label="Emoji"
      >
        🙂
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0, zIndex: 50,
            background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 8, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, width: 224,
          }}
        >
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onSelect(e); setOpen(false); }}
              style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: 4, lineHeight: 1 }}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
