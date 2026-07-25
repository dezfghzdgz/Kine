'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const PRESET_COLORS = ['#00c9a7', '#4f8ef7', '#f7484f', '#f7b84f', '#a34ff7', '#f74fd6', '#4ff77c', '#ffffff'];
const STORAGE_KEY = 'kine-brand-color';

// Appka si barvu pamatuje v tomhle prohlížeči (localStorage) - platí tedy
// napříč všemi zařízeními/kartami, kde se appka otevře ve stejném prohlížeči.
export function applySavedBrandColor() {
  if (typeof window === 'undefined') return;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) document.documentElement.style.setProperty('--brand', saved);
}

export default function BrandLogo({ className }: { className?: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applySavedBrandColor();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function registerClick() {
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 1500);
    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0;
      setPickerOpen(true);
    }
  }

  function applyColor(color: string) {
    document.documentElement.style.setProperty('--brand', color);
    localStorage.setItem(STORAGE_KEY, color);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <Link href="/" className={className} onClick={registerClick}>Kine</Link>

      {pickerOpen && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 200,
            background: 'var(--panel-raised)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 12, width: 190, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          }}
        >
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 8px' }}>Barva appky Kine</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => applyColor(c)}
                style={{
                  width: 26, height: 26, borderRadius: '50%', background: c,
                  border: '1px solid var(--border)', cursor: 'pointer', padding: 0,
                }}
                aria-label={c}
              />
            ))}
            <label
              style={{
                width: 26, height: 26, borderRadius: '50%', cursor: 'pointer',
                border: '1px dashed var(--border)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 13, color: 'var(--text-faint)', position: 'relative', overflow: 'hidden',
              }}
            >
              +
              <input
                type="color"
                onChange={(e) => applyColor(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            style={{
              fontSize: 11, background: 'transparent', border: 'none', color: 'var(--text-faint)',
              cursor: 'pointer', padding: 0, marginTop: 10, textDecoration: 'underline',
            }}
          >
            Zavřít
          </button>
        </div>
      )}
    </div>
  );
}
