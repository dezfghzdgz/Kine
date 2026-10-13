'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, Lang } from '@/lib/i18n';
import ThemeSlider from './ThemeSlider';
import ConfirmDialog from './ConfirmDialog';
import { isTvMode, setTvPreference } from '@/lib/tvMode';
import { APPEARANCE_EVENT, readTheme, saveTheme, type Theme } from '@/lib/appearance';
import UiIcon, { type UiIconName } from './UiIcon';
import { goToSettingsSection } from '@/lib/settingsNav';
import ProfileImage from './ProfileImage';

/** Položka nabídky: ikona a krátký text (vpravo případně hodnota) - jde se podle ikon. */
function ItemLabel({ icon, children }: { icon: UiIconName; children: ReactNode }) {
  return (
    <span className="pdi-label">
      <UiIcon name={icon} size={17} />
      <span>{children}</span>
    </span>
  );
}

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
    // Motiv nastavil už skript v <head> (lib/appearance.ts); tady jen stav přepínače.
    // Změna v Nastavení -> Vzhled se sem promítne událostí.
    const sync = () => setTheme(readTheme());
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
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
    saveTheme(next);
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
          {avatarUrl ? <ProfileImage src={avatarUrl} alt={username} /> : null}
        </span>
        {username}
      </button>

      {open && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-header">
            <span className="profile-avatar-small">
              {avatarUrl ? <ProfileImage src={avatarUrl} alt={username} animate="always" /> : null}
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
            <ItemLabel icon="sliders">{t('settings')}</ItemLabel>
          </Link>

          <Link href="/channel-stats" className="profile-dropdown-item" onClick={() => setOpen(false)}>
            <ItemLabel icon="chart">{t('channelStats')}</ItemLabel>
          </Link>

          <Link href="/download" className="profile-dropdown-item sidebar-desktop-only" onClick={() => setOpen(false)}>
            <ItemLabel icon="desktop">{t('desktopAppLink')}</ItemLabel>
          </Link>

          <Link href="/plus" className="profile-dropdown-item" onClick={() => setOpen(false)}>
            <ItemLabel icon="sparkle">{t('plusPageTitle')}</ItemLabel>
          </Link>

          <div className="profile-dropdown-divider" />

          <div className="theme-slider-row">
            <span className="theme-slider-label">
              <ItemLabel icon={theme === 'light' ? 'sun' : 'moon'}>{THEME_LABELS[theme]}</ItemLabel>
            </span>
            <ThemeSlider theme={theme} onChange={applyTheme} />
          </div>
          <Link href="/settings#appearance" className="profile-dropdown-item" onClick={() => { setOpen(false); goToSettingsSection('appearance'); }}>
            <ItemLabel icon="palette">{t('appearanceCustomize')}</ItemLabel>
          </Link>

          <div style={{ position: 'relative' }}>
            <button
              className="profile-dropdown-item"
              onClick={() => setLangMenuOpen((v) => !v)}
              aria-expanded={langMenuOpen}
            >
              <ItemLabel icon="globe">{t('language')}</ItemLabel>
              <span className="profile-dropdown-value">
                {LANG_NAMES[lang]}
                <UiIcon name="chevronRight" size={14} />
              </span>
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
                    <span>{LANG_NAMES[code]}</span>
                    {lang === code ? <UiIcon name="check" size={15} /> : null}
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
            <ItemLabel icon="tv">{t('tvModeLabel')}</ItemLabel>
            <span className="profile-dropdown-value">{tvOn ? t('onLabel') : t('offLabel')}</span>
          </button>

          <div className="profile-dropdown-divider" />

          {/* Odhlásit se v nabídce chybělo. Potvrzovací okno i obsluha tu
              byly napsané celou dobu, jen na ně nikde nevedlo tlačítko -
              přihlášený člověk se z appky neměl jak odhlásit. */}
          <button
            className="profile-dropdown-item profile-dropdown-signout"
            onClick={() => { setOpen(false); setConfirmSignOut(true); }}
          >
            <ItemLabel icon="logout">{t('signOut')}</ItemLabel>
          </button>

          <div className="profile-dropdown-divider" />

          <div className="profile-dropdown-legal">
            <Link href="/about">{t('aboutLink')}</Link>
            <Link href="/terms">{t('termsLink')}</Link>
            <Link href="/privacy">{t('privacyLink')}</Link>
            <Link href="/rules">{t('rulesLink')}</Link>
            <Link href="/copyright">{t('copyrightLink')}</Link>
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
