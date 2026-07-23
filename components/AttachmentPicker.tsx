'use client';

import { useEffect, useRef, useState } from 'react';
import GifPickerModal from './GifPickerModal';

export default function AttachmentPicker({ onSelect }: { onSelect: (fileOrUrl: File | string) => void }) {
  const [open, setOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none', border: 'none', color: 'var(--text-faint)', padding: '0 10px',
          cursor: 'pointer', fontSize: 20, lineHeight: 1, transform: open ? 'rotate(45deg)' : 'none',
          transition: 'transform 0.15s ease',
        }}
      >
        +
      </button>

      {open && (
        <div className="profile-dropdown" style={{ bottom: 'calc(100% + 8px)', right: 0, left: 'auto', width: 160 }}>
          <button
            type="button"
            className="profile-dropdown-item"
            onClick={() => { photoInputRef.current?.click(); setOpen(false); }}
          >
            🖼️ Photo
          </button>
          <button
            type="button"
            className="profile-dropdown-item"
            onClick={() => { setGifPickerOpen(true); setOpen(false); }}
          >
            GIF
          </button>
        </div>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); e.target.value = ''; }}
      />

      {gifPickerOpen && (
        <GifPickerModal
          onSelect={(url) => { onSelect(url); setGifPickerOpen(false); }}
          onClose={() => setGifPickerOpen(false)}
        />
      )}
    </div>
  );
}
