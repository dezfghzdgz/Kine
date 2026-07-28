'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabaseClient';

const PRESET_COLORS = ['#00c9a7', '#4f8ef7', '#f7484f', '#f7b84f', '#a34ff7', '#f74fd6', '#4ff77c', '#ffffff'];
const STORAGE_KEY = 'kine-brand-color';

// Appka barvu nejdřív zkusí zobrazit rovnou z prohlížeče (rychlé, funguje
// i odhlášeně), a pokud je uživatel přihlášený, hned poté ji dorovná podle
// toho, co má uloženo na účtu - tím se barva přenese i na jiná zařízení.
export function applySavedBrandColor() {
  if (typeof window === 'undefined') return;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) document.documentElement.style.setProperty('--brand', saved);
}

async function applySavedBrandColorFromAccount() {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('brand_color')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profile?.brand_color) {
    document.documentElement.style.setProperty('--brand', profile.brand_color);
    localStorage.setItem(STORAGE_KEY, profile.brand_color);
  }
}

export default function BrandLogo({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applySavedBrandColor();
    applySavedBrandColorFromAccount();

    // Appka barvu z účtu dorovná znovu i hned po přihlášení (ne až po
    // obnovení stránky) - poslouchá si na to změny přihlašovacího stavu.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        applySavedBrandColorFromAccount();
      }
    });
    return () => listener.subscription.unsubscribe();
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

  function registerClick(e: React.MouseEvent) {
    e.preventDefault();
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 1500);

    if (clickCountRef.current >= 5) {
      clickCountRef.current = 0;
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
      setPickerOpen(true);
      return;
    }

    // Appka chvilku počká, než na jedno kliknutí opravdu naviguje pryč -
    // pokud mezitím přijde další klik (směřující k 5), appka tohle
    // odložené přesměrování zruší, ať appku appku appce nezavře uprostřed
    // rychlého poklepávání.
    if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
    navigateTimerRef.current = setTimeout(() => {
      onNavigate?.();
      router.push('/');
    }, 280);
  }

  async function applyColor(color: string) {
    document.documentElement.style.setProperty('--brand', color);
    localStorage.setItem(STORAGE_KEY, color);

    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      await supabase.from('profiles').update({ brand_color: color }).eq('id', authData.user.id);
    }
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
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '0 0 8px' }}>{t('brandColorPickerTitle')}</p>
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
            {t('closeButton')}
          </button>
        </div>
      )}
    </div>
  );
}
