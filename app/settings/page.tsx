'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

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
  const [uploading, setUploading] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    load();
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
      .select('username, display_name, avatar_url, rating_mode, banner_url, bio, social_links, content_preference')
      .eq('id', authData.user.id)
      .single();

    if (profile) {
      setUsername(profile.username ?? '');
      setDisplayName(profile.display_name ?? '');
      setAvatarUrl(profile.avatar_url ?? null);
      setRatingMode((profile.rating_mode as 'stars' | 'like_dislike') ?? 'like_dislike');
      setContentPreference((profile.content_preference as 'short' | 'long') ?? 'long');
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
      setToast({ message: 'Změna se nepovedla: ' + error.message, type: 'error' });
    } else {
      setToast({ message: 'Preference domovské stránky byla změněna', type: 'success' });
    }
  }

  async function changeRatingMode(mode: 'stars' | 'like_dislike') {
    if (!userId) return;
    setRatingMode(mode);
    const { error } = await supabase.from('profiles').update({ rating_mode: mode }).eq('id', userId);
    if (error) {
      setToast({ message: 'Změna se nepovedla: ' + error.message, type: 'error' });
    } else {
      setToast({ message: 'Styl hodnocení videí byl změněn', type: 'success' });
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
      setToast({ message: 'Nahrání fotky se nepovedlo: ' + uploadError.message, type: 'error' });
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
    const newAvatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    await supabase.from('profiles').update({ avatar_url: newAvatarUrl }).eq('id', userId);

    setAvatarUrl(newAvatarUrl);
    setUploading(false);
    setToast({ message: 'Profilová fotka byla aktualizována', type: 'success' });
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setUploadingBanner(true);
    const filePath = `${userId}/banner.${file.name.split('.').pop()}`;

    const { error: uploadError } = await supabase.storage.from('banners').upload(filePath, file, { upsert: true });

    if (uploadError) {
      setToast({ message: 'Nahrání banneru se nepovedlo: ' + uploadError.message, type: 'error' });
      setUploadingBanner(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('banners').getPublicUrl(filePath);
    const newBannerUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

    await supabase.from('profiles').update({ banner_url: newBannerUrl }).eq('id', userId);

    setBannerUrl(newBannerUrl);
    setUploadingBanner(false);
    setToast({ message: 'Banner kanálu byl aktualizován', type: 'success' });
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
    setSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        username,
        display_name: displayName,
        bio,
        social_links: socialLinks.filter((l) => l.label.trim() && l.url.trim()),
      })
      .eq('id', userId);

    setSaving(false);

    if (error) {
      setToast({ message: 'Uložení se nepovedlo: ' + error.message, type: 'error' });
      return;
    }
    setToast({ message: 'Profil byl uložen', type: 'success' });
  }

  if (checking) {
    return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  }

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>Pro úpravu nastavení se musíš nejdřív přihlásit.</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <p className="section-title">{t('profileCustomizationTitle')}</p>

      <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div className="panel">
          <p className="panel-heading">Banner kanálu</p>
          <div
            style={{
              width: '100%', height: 140, borderRadius: 8, marginBottom: 14, overflow: 'hidden',
              background: bannerUrl ? undefined : 'var(--panel-raised)', border: '1px solid var(--border)',
            }}
          >
            {bannerUrl ? (
              <img src={bannerUrl} alt="banner" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : null}
          </div>
          <label htmlFor="banner-upload" style={{ cursor: 'pointer' }}>
            <span style={{
              display: 'inline-block', background: 'var(--panel-raised)', border: '1px solid var(--border)',
              padding: '9px 16px', borderRadius: 8, fontSize: 13,
            }}>
              {uploadingBanner ? t('uploadingBanner') : t('uploadBanner')}
            </span>
            <input
              id="banner-upload"
              type="file"
              accept="image/*"
              onChange={handleBannerChange}
              disabled={uploadingBanner}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        <div className="panel">
          <p className="panel-heading">Profilová fotka</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div className="creator-avatar" style={{ width: 72, height: 72, overflow: 'hidden' }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : null}
            </div>
            <label htmlFor="avatar-upload" style={{ cursor: 'pointer' }}>
              <span style={{
                display: 'inline-block', background: 'var(--panel-raised)', border: '1px solid var(--border)',
                padding: '9px 16px', borderRadius: 8, fontSize: 13,
              }}>
                {uploading ? t('uploadingPhoto') : t('uploadNewPhoto')}
              </span>
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                disabled={uploading}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <p className="panel-heading" style={{ marginBottom: -4 }}>Údaje o profilu</p>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)', display: 'block', marginBottom: 6 }}>Zobrazované jméno</label>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)', display: 'block', marginBottom: 6 }}>Uživatelské jméno</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)', display: 'block', marginBottom: 6 }}>Popis kanálu</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={2}
              placeholder="Něco o tobě a tvém kanálu…"
              style={{ resize: 'vertical', minHeight: 60, maxHeight: 160, width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-faint)', display: 'block', marginBottom: 6 }}>Odkazy (sociální sítě, web…)</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {socialLinks.map((link, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Název (např. Instagram)"
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

        <div className="panel">
          <p className="panel-heading">Styl hodnocení videí</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => changeRatingMode('like_dislike')}
              style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                background: ratingMode === 'like_dislike' ? 'var(--text)' : 'var(--panel-raised)',
                color: ratingMode === 'like_dislike' ? 'var(--bg)' : 'var(--text)',
              }}
            >
              👍 👎 Lajk / Dislike
            </button>
            <button
              type="button"
              onClick={() => changeRatingMode('stars')}
              style={{
                flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                background: ratingMode === 'stars' ? 'var(--text)' : 'var(--panel-raised)',
                color: ratingMode === 'stars' ? 'var(--bg)' : 'var(--text)',
              }}
            >
              ★ Hvězdičky
            </button>
          </div>
        </div>

        <div className="panel">
          <p className="panel-heading">Domovská stránka</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => changeContentPreference('long')}
              style={{
                flex: 1, background: contentPreference === 'long' ? 'var(--text)' : 'var(--panel-raised)',
                color: contentPreference === 'long' ? 'var(--bg)' : 'var(--text)',
              }}
            >
              🎬 Delší videa
            </button>
            <button
              type="button"
              onClick={() => changeContentPreference('short')}
              style={{
                flex: 1, background: contentPreference === 'short' ? 'var(--text)' : 'var(--panel-raised)',
                color: contentPreference === 'short' ? 'var(--bg)' : 'var(--text)',
              }}
            >
              ⚡ Sparks
            </button>
          </div>
        </div>

        <button type="submit" disabled={saving} style={{ marginTop: 4 }}>
          {saving ? t('saving') : t('saveChanges')}
        </button>
      </form>

      <div className="panel" style={{ marginTop: 32 }}>
        <p className="panel-heading">Tvoje data</p>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
          Podle GDPR máš právo si stáhnout všechna data, která o tobě appka má,
          i právo appku požádat o jejich úplné smazání.
        </p>
        <button type="button" onClick={handleExportData} disabled={exporting} style={{ marginBottom: 10 }}>
          {exporting ? 'Připravuji…' : 'Stáhnout moje data'}
        </button>
        <div>
          <button
            type="button"
            onClick={() => setConfirmDeleteAccount(true)}
            style={{ background: 'var(--panel-raised)', color: '#ff6b6b', border: '1px solid var(--border)' }}
          >
            Trvale smazat účet
          </button>
        </div>
      </div>

      {confirmDeleteAccount && (
        <ConfirmDialog
          message={t('confirmDeleteAccount')}
          onConfirm={handleDeleteAccount}
          onCancel={() => setConfirmDeleteAccount(false)}
        />
      )}
    </div>
  );
}
