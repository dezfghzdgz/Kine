'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      setError(t('wrongEmailOrPassword'));
      setToast({ message: t('loginFailed'), type: 'error' });
      setLoading(false);
      return;
    }

    let redirectTo: string | null = null;

    if (data.user) {
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id, rating_mode, agreed_to_rules, content_preference')
        .eq('id', data.user.id)
        .maybeSingle();

      if (!existingProfile) {
        const fallbackUsername = data.user.email?.split('@')[0] ?? `user_${data.user.id.slice(0, 6)}`;
        await supabase.from('profiles').insert({
          id: data.user.id,
          username: fallbackUsername,
          display_name: fallbackUsername,
        });
        await supabase.from('playlists').insert({
          owner_id: data.user.id,
          title: 'Sledovat později',
          color: '#3a5a8a',
          is_system: true,
        });
        redirectTo = '/agree-to-rules';
      } else if (!existingProfile.agreed_to_rules) {
        redirectTo = '/agree-to-rules';
      } else if (!existingProfile.rating_mode) {
        redirectTo = '/choose-rating-mode';
      } else if (!existingProfile.content_preference) {
        redirectTo = '/choose-content-preference';
      }
    }

    setToast({ message: t('loginSuccess'), type: 'success' });
    setTimeout(() => {
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.push('/');
        router.refresh();
      }
    }, 900);
  }

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <form className="form-container" onSubmit={handleLogin}>
        <h1>{t('login')}</h1>
        <input
          type="email"
          placeholder={t('email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder={t('password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? t('signingIn') : t('login')}
        </button>
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          {t('noAccount')} <Link href="/signup" style={{ color: 'var(--accent)' }}>{t('signup')}</Link>
        </p>
        <Link href="/forgot-password" style={{ color: 'var(--text-faint)', fontSize: 13 }}>
          {t('forgotPassword')}
        </Link>
      </form>
    </>
  );
}
