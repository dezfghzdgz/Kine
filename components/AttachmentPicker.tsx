'use client';

import { useEffect, useRef, useState } from 'react';
import GifPickerModal from './GifPickerModal';
import UiIcon from './UiIcon';
import { useLanguage } from '@/lib/i18n';

export default function AttachmentPicker({ onSelect }: { onSelect: (fileOrUrl: File | string) => void }) {
  const { t } = useLanguage();
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
      {/* Ikona + (ne znak z písma - ten sedí každému systému jinak a nebyl srovnaný se smajlíkem). */}
      <button
        type="button"
        className={`composer-icon-btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={`${t('postPhotoTab')} / GIF`}
        aria-expanded={open}
        title={`${t('postPhotoTab')} / GIF`}
      >
        <UiIcon name="plus" size={19} />
      </button>

      {open && (
        <div className="profile-dropdown" style={{ bottom: 'calc(100% + 8px)', right: 0, left: 'auto', width: 160 }}>
          <button
            type="button"
            className="profile-dropdown-item"
            onClick={() => { photoInputRef.current?.click(); setOpen(false); }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <UiIcon name="image" size={16} />
              {t('postPhotoTab')}
            </span>
          </button>
          <button
            type="button"
            className="profile-dropdown-item"
            onClick={() => { setGifPickerOpen(true); setOpen(false); }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <UiIcon name="sparkle" size={16} />
              GIF
            </span>
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
