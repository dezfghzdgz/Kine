'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, Lang } from '@/lib/i18n';
import ThemeSlider from './ThemeSlider';
import ConfirmDialog from './ConfirmDialog';
import { isTvMode, setTvPreference } from '@/lib/tvMode';

const LANG_NAMES: Record<Lang, string> = {
  cs: 'Čeština',
  en: 'English',
  de: 'Deutsch',
  sk: 'Slovenčina',
  es: 'Español',
  pl: 'Polski',
  fr: 'Français',
  uk: 'Українська',
};

type Theme = 'dark' | 'gray' | 'light';

export default function ProfileMenu({
  username,
  avatarUrl,
}: {
  username: string;
  avatarUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const { lang, setLang, t } = useLanguage();
  const THEME_LABELS: Record<Theme, string> = {
    dark: t('themeDark'),
    gray: t('themeGray'),
    light: t('themeLight'),
  };
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const saved = (localStorage.getItem('kine-theme') as Theme) || 'dark';
    setTheme(saved);
    document.documentElement.setAttribute('data-theme', saved);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setLangMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Stav přepínače televize - čte se z <html> při otevření nabídky.
  const [tvOn, setTvOn] = useState(false);
  useEffect(() => {
    if (open) setTvOn(isTvMode());
  }, [open]);

  function applyTheme(next: Theme) {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('kine-theme', next);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setConfirmSignOut(false);
    setOpen(false);
    router.push('/');
    router.refresh();
  }

  return (
    <div className="profile-menu" ref={menuRef}>
      <button className="sidebar-link profile-trigger" onClick={() => { setOpen((v) => !v); setLangMenuOpen(false); }}>
        <span className="profile-avatar-small">
          {avatarUrl ? <img loading="lazy" decoding="async" src={avatarUrl} alt={username} /> : null}
        </span>
        {username}
      </button>

      {open && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-header">
            <span className="profile-avatar-small">
              {avatarUrl ? <img loading="lazy" decoding="async" src={avatarUrl} alt={username} /> : null}
            </span>
            <div>
              <p className="profile-dropdown-name">{username}</p>
              <Link href="/channel/me" className="profile-dropdown-link" onClick={() => setOpen(false)}>
                {t('viewChannel')}
              </Link>
            </div>
          </div>

          <div className="profile-dropdown-divider" />

          <Link href="/settings" className="profile-dropdown-item" onClick={() => setOpen(false)}>
            {t('settings')}
          </Link>

          <Link href="/channel-stats" className="profile-dropdown-item" onClick={() => setOpen(false)}>
            {t('channelStats')}
          </Link>

          <div className="theme-slider-row">
            <span className="theme-slider-label">{t('appearance')}: {THEME_LABELS[theme]}</span>
            <ThemeSlider theme={theme} onChange={applyTheme} />
          </div>

          <div style={{ position: 'relative' }}>
            <button
              className="profile-dropdown-item"
              onClick={() => setLangMenuOpen((v) => !v)}
            >
              <span>{t('language')}</span>
              <span className="profile-dropdown-value">{LANG_NAMES[lang]}</span>
            </button>
            {langMenuOpen && (
              <div
                className="profile-dropdown"
                style={{ position: 'absolute', top: 0, left: 'calc(100% + 8px)', bottom: 'auto', width: 170, maxHeight: 260, overflowY: 'auto' }}
              >
                {(Object.keys(LANG_NAMES) as Lang[]).map((code) => (
                  <button
                    key={code}
                    className="profile-dropdown-item"
                    onClick={() => { setLang(code); setLangMenuOpen(false); }}
                    style={{ fontWeight: lang === code ? 700 : 400 }}
                  >
                    {LANG_NAMES[code]} {lang === code ? '✓' : ''}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Režim televize: zvětšení a ovládání šipkami. Na Smart TV se
              zapne sám, tady se dá přepnout ručně (lib/tvMode.ts). */}
          <button
            className="profile-dropdown-item"
            onClick={() => {
              const next = isTvMode() ? 'off' : 'on';
              setTvPreference(next);
              setTvOn(next === 'on');
            }}
          >
            <span>{t('tvModeLabel')}</span>
            <span className="profile-dropdown-value">{tvOn ? t('onLabel') : t('offLabel')}</span>
          </button>

          <div className="profile-dropdown-divider" style={{ marginTop: 10 }} />

          {/* Odhlásit se v nabídce chybělo. Potvrzovací okno i obsluha tu
              byly napsané celou dobu, jen na ně nikde nevedlo tlačítko -
              přihlášený člověk se z appky neměl jak odhlásit. */}
          <button
            className="profile-dropdown-item profile-dropdown-signout"
            onClick={() => { setOpen(false); setConfirmSignOut(true); }}
          >
            {t('signOut')}
          </button>

          <div className="profile-dropdown-divider" />

          <div className="profile-dropdown-legal">
            <Link href="/terms">{t('termsLink')}</Link>
            <Link href="/privacy">{t('privacyLink')}</Link>
            <Link href="/rules">{t('rulesLink')}</Link>
            <a href="mailto:kinesupport@gmail.com">{t('supportLink')}</a>
          </div>
        </div>
      )}
      {confirmSignOut && (
        <ConfirmDialog
          message={t('confirmSignOutNote')}
          confirmLabel={t('signOut')}
          danger={false}
          onConfirm={handleSignOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      )}
    </div>
  );
}
