'use client';

import { useEffect, useRef, useState } from 'react';
import UiIcon from './UiIcon';

const EMOJIS = [
  '😀', '😂', '🥲', '😍', '😎', '🤔', '😢', '😭', '😡', '🥳',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '💯', '✨', '⭐',
  '❤️', '💔', '😱', '😴', '🤯', '🥶', '🤣', '😅', '😉', '🤩',
  '👀', '💀', '🎉', '✅', '❌', '🤝', '🫶', '😏', '🙄', '😬',
];

/**
 * `direction`: kam se nabídka otevře. Výchozí nahoru (pole na psaní bývá dole
 * na stránce). V panelu, který se sám roluje (sloupec vedle přehrávače na
 * stránce videa), by nabídka nahoře vyjela z panelu a ořízla se - tam 'down'.
 */
export default function EmojiPicker({ onSelect, direction = 'up' }: { onSelect: (emoji: string) => void; direction?: 'up' | 'down' }) {
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
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {/* Vlastní třída: bez ní by tlačítko dostalo ze základního stylu skleněný ovál. */}
      <button type="button" className="composer-icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Emoji" aria-expanded={open} title="Emoji">
        <UiIcon name="smile" size={19} />
      </button>
      {open && (
        <div
          style={{
            // Tlačítko je u pravého okraje pole - nabídka se otevře doleva, ať nevyjede z panelu.
            position: 'absolute', right: 0, zIndex: 50,
            ...(direction === 'down' ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }),
            background: 'var(--overlay-bg-raised)', border: '1px solid var(--border)', borderRadius: 8,
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
