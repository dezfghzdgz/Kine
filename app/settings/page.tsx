'use client';

import { useEffect, useState } from 'react';
import { useLanguage, type DictKey } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { validateUsername } from '@/lib/username';
import AppearanceSettings from '@/components/AppearanceSettings';
import UiIcon, { type UiIconName } from '@/components/UiIcon';
import { PanelHeading, WithHelp } from '@/components/HelpTip';
import { ThumbsDownIcon, ThumbsUpIcon } from '@/components/ReactionIcons';
import { SETTINGS_SECTION_EVENT } from '@/lib/settingsNav';

/**
 * Nastavení po oddílech: nahoře řada ikon (profil, vzhled, domovská
 * stránka, výdělky, účet), pod ní jen ten jeden oddíl. Oddíl je i v adrese
 * (#appearance, #earnings…), takže odkazy z nabídky a odjinud vedou rovnou
 * na místo. Vysvětlení jsou pod otazníčky.
 */
type Section = 'profile' | 'appearance' | 'home' | 'earnings' | 'account';
const SECTIONS: { id: Section; icon: UiIconName; key: DictKey }[] = [
  { id: 'profile', icon: 'user', key: 'settingsSecProfile' },
  { id: 'appearance', icon: 'palette', key: 'appearanceHeading' },
  { id: 'home', icon: 'home', key: 'settingsSecHome' },
  { id: 'earnings', icon: 'coins', key: 'settingsSecEarnings' },
  { id: 'account', icon: 'shield', key: 'settingsSecAccount' },
];

function sectionFromHash(hash: string): Section | null {
  const id = hash.replace(/^#/, '');
  return SECTIONS.some((x) => x.id === id) ? (id as Section) : null;
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [socialLinks, setSocialLinks] = useState<{ label: string; url: string }[]>([
    { label: '', url: '' }, { label: '', url: '' }, { label: '', url: '' },
  ]);
  const [ratingMode, setRatingMode] = useState<'stars' | 'like_dislike'>('like_dislike');
  const [contentPreference, setContentPreference] = useState<'short' | 'long'>('long');
  const [disableShorts, setDisableShorts] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [confirmSignOutSettings, setConfirmSignOutSettings] = useState(false);
  const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);
  const [stripeOnboardingComplete, setStripeOnboardingComplete] = useState(false);
  const [subscriptionPrice, setSubscriptionPrice] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [connectLoading, setConnectLoading] = useState(false);
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [section, setSection] = useState<Section>('profile');

  // Oddíl z adresy (#appearance…), při změně zpátky do adresy (bez nového záznamu v historii).
  useEffect(() => {
    const fromHash = sectionFromHash(window.location.hash);
    if (fromHash) setSection(fromHash);
    const onHash = () => {
      const next = sectionFromHash(window.location.hash);
      if (next) setSection(next);
    };
    const onEvent = (e: Event) => {
      const next = sectionFromHash(String((e as CustomEvent).detail ?? ''));
      if (next) setSection(next);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener(SETTINGS_SECTION_EVENT, onEvent);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(SETTINGS_SECTION_EVENT, onEvent);
    };
  }, []);

  function openSection(next: Section) {
    setSection(next);
    try {
      window.history.replaceState(window.history.state, '', `#${next}`);
    } catch {
      // nevadí - oddíl se jen nezapíše do adresy
    }
  }

  useEffect(() => {
    load();
    if (typeof window !== 'undefined' && window.location.search.includes('stripe_return')) {
      checkStripeStatus();
    }
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setChecking(false);
      return;
    }
    setUserId(authData.user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('username, display_name, avatar_url, rating_mode, banner_url, bio, social_links, content_preference, disable_shorts, subscription_price_eur')
      .eq('id', authData.user.id)
      .single();

    if (profile) {
      setUsername(profile.username ?? '');
      setDisplayName(profile.display_name ?? '');
      setAvatarUrl(profile.avatar_url ?? null);
      setRatingMode((profile.rating_mode as 'stars' | 'like_dislike') ?? 'like_dislike');
      setContentPreference((profile.content_preference as 'short' | 'long') ?? 'long');
      setDisableShorts(!!profile.disable_shorts);
      // Údaje o napojení na Stripe patří jen majiteli účtu, takže se čtou
      // funkcí, ne přímo ze sloupců.
      const { data: accountRows } = await supabase.rpc('my_account');
      const account = Array.isArray(accountRows) ? accountRows[0] : accountRows;
      setStripeAccountId(account?.stripe_account_id ?? null);
      setStripeOnboardingComplete(!!account?.stripe_onboarding_complete);
      setSubscriptionPrice(profile.subscription_price_eur ? String(profile.subscription_price_eur) : '');
      setBannerUrl(profile.banner_url ?? null);
      setBio(profile.bio ?? '');
      const existingLinks = (profile.social_links as { label: string; url: string }[]) ?? [];
      setSocialLinks([0, 1, 2].map((i) => existingLinks[i] ?? { label: '', url: '' }));
    }
    setChecking(false);
  }

  async function changeContentPreference(pref: 'short' | 'long') {
    if (!userId) return;
    setContentPreference(pref);
    const { error } = await supabase.from('profiles').update({ content_preference: pref }).eq('id', userId);
    if (error) {
      setToast({ message: `${t('settingsChangeFailed')}: ${error.message}`, type: 'error' });
    } else {
      setToast({ message: t('settingsHomepageChanged'), type: 'success' });
    }
  }

  async function changeDisableShorts(value: boolean) {
    if (!userId) return;
    setDisableShorts(value);
    await supabase.from('profiles').update({ disable_shorts: value }).eq('id', userId);
  }

  async function startStripeOnboarding() {
    setConnectLoading(true);
    setPriceError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const res = await fetch('/api/creator/connect-onboarding', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setPriceError(data.error ?? t('donateGenericError'));
      }
    } catch (err: any) {
      setPriceError(err.message ?? t('donateGenericError'));
    } finally {
      setConnectLoading(false);
    }
  }

  async function checkStripeStatus() {
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/creator/check-onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const data = await res.json();
    setStripeOnboardingComplete(!!data.complete);
  }

  async function saveSubscriptionPrice(e: React.FormEvent) {
    e.preventDefault();
    setPriceError(null);
    setPriceLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/creator/set-subscription-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token}` },
      body: JSON.stringify({ priceEur: Number(priceInput) }),
    });
    const data = await res.json();
    setPriceLoading(false);
    if (data.ok) {
      setSubscriptionPrice(priceInput);
      setToast({ message: t('subscriptionPriceSavedNote'), type: 'success' });
    } else {
      setPriceError(data.error ?? t('donateGenericError'));
    }
  }

  async function changeRatingMode(mode: 'stars' | 'like_dislike') {
    if (!userId) return;
    setRatingMode(mode);
    const { error } = await supabase.from('profiles').update({ rating_mode: mode }).eq('id', userId);
    if (error) {
      setToast({ message: `${t('settingsChangeFailed')}: ${error.message}`, type: 'error' });
    } else {
      setToast({ message: t('settingsRatingChanged'), type: 'success' });
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setUploading(true);
    const filePath = `${userId}/avatar.${file.name.split('.').pop()}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      setToast({ message: `${t('settingsPhotoFailed')}: ${uploadError.message}`, type: 'error' });
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
    const newAvatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    await supabase.from('profiles').update({ avatar_url: newAvatarUrl }).eq('id', userId);

    setAvatarUrl(newAvatarUrl);
    setUploading(false);
    setToast({ message: t('settingsPhotoUpdated'), type: 'success' });
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setUploadingBanner(true);
    const filePath = `${userId}/banner.${file.name.split('.').pop()}`;

    const { error: uploadError } = await supabase.storage.from('banners').upload(filePath, file, { upsert: true });

    if (uploadError) {
      setToast({ message: `${t('settingsBannerFailed')}: ${uploadError.message}`, type: 'error' });
      setUploadingBanner(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('banners').getPublicUrl(filePath);
    const newBannerUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    await supabase.from('profiles').update({ banner_url: newBannerUrl }).eq('id', userId);

    setBannerUrl(newBannerUrl);
    setUploadingBanner(false);
    setToast({ message: t('settingsBannerUpdated'), type: 'success' });
  }

  async function handleExportData() {
    setExporting(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/account/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const data = await res.json();

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kine-moje-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExporting(false);
  }

  async function handleSignOutFromSettings() {
    await supabase.auth.signOut();
    setConfirmSignOutSettings(false);
    router.push('/');
    router.refresh();
  }

  async function handleDeleteAccount() {
    setConfirmDeleteAccount(false);
    const { data: sessionData } = await supabase.auth.getSession();
    await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    await supabase.auth.signOut();
    router.push('/');
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;

    // Prázdné jméno se sem dostalo právě tudy - pole nemá "required" a
    // uložit se dalo cokoliv. Databáze to teď odmítne sama, ale hláška
    // odtamtud je pro čtení dost nepříjemná.
    const usernameProblem = validateUsername(username);
    if (usernameProblem) {
      setToast({ message: t(usernameProblem), type: 'error' });
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        username: username.trim(),
        display_name: displayName,
        bio,
        social_links: socialLinks.filter((l) => l.label.trim() && l.url.trim()),
      })
      .eq('id', userId);

    setSaving(false);

    if (error) {
      setToast({ message: `${t('settingsSaveFailed')}: ${error.message}`, type: 'error' });
      return;
    }
    setToast({ message: t('settingsProfileSaved'), type: 'success' });
  }

  if (checking) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  }

  if (!userId) {
    // Vzhled jde nastavit i bez účtu (ukládá se do zařízení).
    return (
      <div className="settings-page" style={{ maxWidth: 680 }}>
        <h1 className="settings-title">{t('settings')}</h1>
        <AppearanceSettings />
        <div className="auth-gate">
          <p>{t('loginToEditSettingsNote')}</p>
          <Link href="/login">{t('loginLink')}</Link>
        </div>
      </div>
    );
  }

  const choice = (active: boolean) => `settings-choice${active ? ' active' : ''}`;

  return (
    <div className="settings-page" style={{ maxWidth: 680 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <h1 className="settings-title">{t('settings')}</h1>
      <nav className="settings-nav" aria-label={t('settings')}>
        {SECTIONS.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`settings-nav-item${section === x.id ? ' active' : ''}`}
            aria-current={section === x.id ? 'page' : undefined}
            data-section={x.id}
            onClick={() => openSection(x.id)}
          >
            <UiIcon name={x.icon} size={21} />
            <span>{t(x.key)}</span>
          </button>
        ))}
      </nav>

      {/* Vzhled: motiv, sklo, pozadí, průhlednost, světlo kolem videa, barva. */}
      {section === 'appearance' && <AppearanceSettings />}

      {section === 'profile' && (
        <form onSubmit={handleSaveProfile} className="settings-stack">
          <div className="panel">
            <PanelHeading icon="image" title={t('channelBannerLabel')} />
            <div className="settings-banner">
              {bannerUrl ? <img loading="lazy" decoding="async" src={bannerUrl} alt="" /> : null}
            </div>
            <label htmlFor="banner-upload" className="settings-file-button">
              <UiIcon name="upload" size={16} />
              <span>{uploadingBanner ? t('uploadingBanner') : t('uploadBanner')}</span>
              <input id="banner-upload" type="file" accept="image/*" onChange={handleBannerChange} disabled={uploadingBanner} style={{ display: 'none' }} />
            </label>
          </div>

          <div className="panel">
            <PanelHeading icon="user" title={t('profilePhotoLabel')} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div className="creator-avatar" style={{ width: 72, height: 72, overflow: 'hidden' }}>
                {avatarUrl ? <img loading="lazy" decoding="async" src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
              </div>
              <label htmlFor="avatar-upload" className="settings-file-button">
                <UiIcon name="camera" size={16} />
                <span>{uploading ? t('uploadingPhoto') : t('uploadNewPhoto')}</span>
                <input id="avatar-upload" type="file" accept="image/*" onChange={handleAvatarChange} disabled={uploading} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <PanelHeading icon="pencil" title={t('profileDataHeading')} />
            <div>
              <label className="settings-label">{t('displayNameLabel')}</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="settings-label">{t('usernameLabel')}</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="settings-label">{t('channelDescriptionLabel')}</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={2}
                placeholder={t('aboutYouPlaceholder')}
                style={{ resize: 'vertical', minHeight: 60, maxHeight: 160, width: '100%' }}
              />
            </div>
            <div>
              <label className="settings-label">
                <UiIcon name="link" size={14} /> {t('socialLinksLabel')}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {socialLinks.map((link, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      placeholder={t('linkNamePlaceholder')}
                      value={link.label}
                      onChange={(e) => {
                        const next = [...socialLinks];
                        next[i] = { ...next[i], label: e.target.value };
                        setSocialLinks(next);
                      }}
                      style={{ width: '40%' }}
                    />
                    <input
                      type="text"
                      placeholder="https://…"
                      value={link.url}
                      onChange={(e) => {
                        const next = [...socialLinks];
                        next[i] = { ...next[i], url: e.target.value };
                        setSocialLinks(next);
                      }}
                      style={{ flex: 1 }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button type="submit" disabled={saving} className="settings-save">
            <UiIcon name="check" size={17} />
            <span>{saving ? t('saving') : t('saveChanges')}</span>
          </button>
        </form>
      )}

      {section === 'home' && (
        <div className="settings-stack">
          <div className="panel">
            <PanelHeading icon="star" title={t('ratingStyleHeading')} />
            <div className="settings-choices">
              <button type="button" className={choice(ratingMode === 'like_dislike')} aria-pressed={ratingMode === 'like_dislike'} onClick={() => changeRatingMode('like_dislike')}>
                <ThumbsUpIcon size={18} />
                <ThumbsDownIcon size={18} />
                <span>{t('ratingLikeDislike')}</span>
              </button>
              <button type="button" className={choice(ratingMode === 'stars')} aria-pressed={ratingMode === 'stars'} onClick={() => changeRatingMode('stars')}>
                <UiIcon name="star" size={18} />
                <span>{t('ratingStars')}</span>
              </button>
            </div>
          </div>

          <div className="panel">
            <PanelHeading icon="home" title={t('homepageHeading')} />
            <div className="settings-choices">
              <button type="button" className={choice(contentPreference === 'long')} aria-pressed={contentPreference === 'long'} onClick={() => changeContentPreference('long')}>
                <UiIcon name="film" size={18} />
                <span>{t('longVideosOption')}</span>
              </button>
              <button type="button" className={choice(contentPreference === 'short')} aria-pressed={contentPreference === 'short'} onClick={() => changeContentPreference('short')}>
                <UiIcon name="phone" size={18} />
                <span>{t('sparksOption')}</span>
              </button>
            </div>
            <WithHelp help={t('disableShortsHint')} className="settings-option">
              <label className="settings-check">
                <input type="checkbox" checked={disableShorts} onChange={(e) => changeDisableShorts(e.target.checked)} />
                <span>{t('disableShortsLabel')}</span>
              </label>
            </WithHelp>
          </div>
        </div>
      )}

      {section === 'earnings' && (
        <div className="panel" id="earnings">
          <PanelHeading icon="coins" title={t('creatorEarningsTitle')} help={t('creatorEarningsIntro')} />
          {!stripeOnboardingComplete ? (
            <>
              <button type="button" onClick={startStripeOnboarding} disabled={connectLoading} className="settings-icon-button">
                <UiIcon name="link" size={16} />
                <span>{connectLoading ? t('processing') : t('connectStripeButton')}</span>
              </button>
              {priceError && <p className="error-text" style={{ marginTop: 8 }}>{priceError}</p>}
            </>
          ) : (
            <>
              <p className="settings-ok">
                <UiIcon name="check" size={16} /> {t('stripeConnectedNote')}
              </p>
              <form onSubmit={saveSubscriptionPrice}>
                <label className="settings-label">{t('subscriptionPriceLabel')}</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step="0.5"
                    placeholder={subscriptionPrice || '5'}
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" disabled={priceLoading}>
                    {priceLoading ? t('saving') : t('saveChanges')}
                  </button>
                </div>
                {subscriptionPrice && (
                  <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
                    {t('currentPriceNote')} {subscriptionPrice} €/{t('perMonth')}
                  </p>
                )}
                {priceError && <p className="error-text" style={{ marginTop: 8 }}>{priceError}</p>}
              </form>
            </>
          )}
        </div>
      )}

      {section === 'account' && (
        <div className="settings-stack">
          <div className="panel">
            <PanelHeading icon="database" title={t('yourDataHeading')} help={t('gdprNote')} />
            <div className="settings-actions">
              <button type="button" onClick={handleExportData} disabled={exporting} className="settings-icon-button">
                <UiIcon name="download" size={16} />
                <span>{exporting ? t('preparingLabel') : t('downloadMyDataButton')}</span>
              </button>
              <button type="button" onClick={() => setConfirmDeleteAccount(true)} className="settings-icon-button settings-danger">
                <UiIcon name="trash" size={16} />
                <span>{t('permanentlyDeleteAccountButton')}</span>
              </button>
            </div>
          </div>

          <div className="panel">
            <button type="button" onClick={() => setConfirmSignOutSettings(true)} className="settings-icon-button settings-danger">
              <UiIcon name="logout" size={16} />
              <span>{t('signOut')}</span>
            </button>
          </div>
        </div>
      )}

      {confirmDeleteAccount && (
        <ConfirmDialog
          message={t('confirmDeleteAccount')}
          onConfirm={handleDeleteAccount}
          onCancel={() => setConfirmDeleteAccount(false)}
        />
      )}

      {confirmSignOutSettings && (
        <ConfirmDialog
          message={t('confirmSignOutNote')}
          confirmLabel={t('signOut')}
          danger={false}
          onConfirm={handleSignOutFromSettings}
          onCancel={() => setConfirmSignOutSettings(false)}
        />
      )}
    </div>
  );
}
