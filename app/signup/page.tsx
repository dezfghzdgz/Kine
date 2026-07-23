'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

export default function SignupPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError(t('passwordsDontMatch'));
      setToast({ message: t('signupFailed'), type: 'error' });
      return;
    }

    setLoading(true);

    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      setError(signupError.message);
      setToast({ message: t('signupFailed'), type: 'error' });
      setLoading(false);
      return;
    }

    if (data.session) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: data.user!.id,
        username,
        display_name: username,
      });

      if (profileError) {
        setError('Účet vytvořen, ale profil se nepodařilo založit: ' + profileError.message);
        setToast({ message: t('signupFailed'), type: 'error' });
        setLoading(false);
        return;
      }

      await supabase.from('playlists').insert({
        owner_id: data.user!.id,
        title: 'Sledovat později',
        color: '#3a5a8a',
        is_system: true,
      });

      setToast({ message: t('signupSuccess'), type: 'success' });
      setTimeout(() => router.push('/agree-to-rules'), 900);
      return;
    }

    setToast({ message: t('signupSuccess'), type: 'success' });
    setLoading(false);
    setTimeout(() => router.push('/login?justSignedUp=1'), 900);
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <form className="form-container" onSubmit={handleSignup}>
        <h1>{t('createAccount')}</h1>
        <div>
          <input
            type="text"
            placeholder={t('username')}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
            {t('usernameHint')}
          </p>
        </div>
        <div>
          <input
            type="email"
            placeholder={t('email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
            {t('emailHint')}
          </p>
        </div>
        <div>
          <input
            type="password"
            placeholder={t('password') + ' (min. 6)'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 4 }}>
            {t('passwordHint')}
          </p>
        </div>
        <input
          type="password"
          placeholder={t('repeatPassword')}
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          minLength={6}
          required
        />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--text-dim)' }}>
          <input type="checkbox" required style={{ width: 'auto', marginTop: 3 }} />
          <span>
            {t('agreeToTerms')} <a href="/terms" target="_blank" style={{ color: 'var(--text)' }}>{t('termsOfService')}</a> {t('and')}{' '}
            <a href="/privacy" target="_blank" style={{ color: 'var(--text)' }}>{t('privacyPolicy')}</a>.
          </span>
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? t('creatingAccount') : t('signUpButton')}
        </button>
      </form>
    </>
  );
}
