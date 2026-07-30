'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n';
import { SparkIcon } from './Sidebar';
import { FireIcon, SparkleIcon, DiceIcon, TagIcon } from './ReactionIcons';

const SPARKS_SHORTCUT_OPTIONS = [
  { key: 'sparks', href: '/sparks', labelKey: null, icon: SparkIcon },
  { key: 'trending', href: '/explore?tab=trending', labelKey: 'trending', icon: FireIcon },
  { key: 'newest', href: '/explore?tab=newest', labelKey: 'newest', icon: SparkleIcon },
  { key: 'surprise', href: '/explore?tab=surprise', labelKey: 'surprise', icon: DiceIcon },
  { key: 'music', href: '/explore?category=catMusic', labelKey: 'catMusic', icon: TagIcon },
  { key: 'films', href: '/explore?category=catFilm', labelKey: 'catFilm', icon: TagIcon },
  { key: 'games', href: '/explore?category=catGaming', labelKey: 'catGaming', icon: TagIcon },
];

export default function SparksNavButton() {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const [chosen, setChosen] = useState('sparks');
  const [pickerOpen, setPickerOpen] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('kine-sparks-nav-choice');
    if (saved) setChosen(saved);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const option = SPARKS_SHORTCUT_OPTIONS.find((o) => o.key === chosen) ?? SPARKS_SHORTCUT_OPTIONS[0];
  const Icon = option.icon;

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 1500);

    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0;
      setPickerOpen(true);
      return;
    }
    router.push(option.href);
  }

  function choose(key: string) {
    setChosen(key);
    localStorage.setItem('kine-sparks-nav-choice', key);
    setPickerOpen(false);
  }

  const active = pathname === option.href.split('?')[0] && (option.key === 'sparks' || pathname === '/explore');

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button className={`mobile-nav-item ${active ? 'active' : ''}`} onClick={handleClick}>
        <Icon />
        <span>{option.labelKey ? t(option.labelKey as any) : 'Sparks'}</span>
      </button>

      {pickerOpen && (
        <div className="profile-dropdown" style={{ width: 220 }}>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '4px 8px 10px' }}>{t('chooseNotificationIconNote')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 4px 8px' }}>
            {SPARKS_SHORTCUT_OPTIONS.map((opt) => {
              const OptIcon = opt.icon;
              return (
                <button
                  key={opt.key}
                  onClick={() => choose(opt.key)}
                  className="profile-dropdown-item"
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: chosen === opt.key ? 700 : 400 }}
                >
                  <OptIcon />
                  <span style={{ flex: 1, textAlign: 'left' }}>{opt.labelKey ? t(opt.labelKey as any) : 'Sparks'}</span>
                  {chosen === opt.key && <span>✓</span>}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setPickerOpen(false)}
            className="profile-dropdown-item"
            style={{ textAlign: 'center', color: 'var(--text-faint)' }}
          >
            {t('cancel')}
          </button>
        </div>
      )}
    </div>
  );
}
