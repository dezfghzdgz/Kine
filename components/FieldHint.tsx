'use client';

import { useEffect, useRef, useState } from 'react';

const POPOVER_WIDTH = 220;
const EDGE = 8;

/**
 * Otazníček s vysvětlením (heslovitě na stránce, víc po klepnutí). Bublina se drží
 * uvnitř obrazovky: u otazníčku blízko pravého okraje (telefon) se posune doleva -
 * dřív přetékala a stránka šla rolovat do strany. Písmo vlastní (ne podle nadpisu,
 * ve kterém otazníček je). U horního okraje stránky se otevře pod otazníčkem (nad ním
 * by ji zakryla lišta s hledáním).
 */
export default function FieldHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  // Bublina nad otazníčkem; u horního okraje (pod lištou s hledáním) pod ním.
  const [below, setBelow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggle() {
    const next = !open;
    if (next && ref.current && typeof window !== 'undefined') {
      const rect = ref.current.getBoundingClientRect();
      const left = rect.left;
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * EDGE);
      setBelow(rect.top < 200);
      // Kolik doleva, aby pravý okraj bubliny zůstal na obrazovce (a levý nevyjel ven).
      setShift(Math.max(EDGE - left, Math.min(0, window.innerWidth - EDGE - width - left)));
    }
    setOpen(next);
  }

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block', marginLeft: 6 }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        aria-expanded={open}
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
          role="tooltip"
          style={{
            position: 'absolute', ...(below ? { top: 'calc(100% + 6px)' } : { bottom: 'calc(100% + 6px)' }), left: shift, width: POPOVER_WIDTH, maxWidth: `calc(100vw - ${2 * EDGE}px)`, zIndex: 30,
            background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 10, fontSize: 12, fontWeight: 400, letterSpacing: 'normal', textAlign: 'left', textTransform: 'none',
            color: 'var(--text-dim)', lineHeight: 1.4, whiteSpace: 'normal',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
