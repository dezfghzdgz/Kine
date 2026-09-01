'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

const LOCK_DURATION_MINUTES = 15;

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  // Volá appce vlastní API pro hlídání pokusů o přihlášení. Pokud tohle
  // API z jakéhokoliv důvodu selže (ještě neproběhla SQL migrace, výpadek
  // sítě...), appka to jen potichu přeskočí a pokračuje dál - přihlášení
  // samotné na tom nesmí nikdy zůstat "viset".
  async function callLockoutApi(action: 'check' | 'record-failure' | 'reset') {
    try {
      const res = await fetch('/api/login-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Nejdřív zkontrolujeme, jestli tenhle účet není dočasně uzamčený kvůli
      // předchozím opakovaným špatným pokusům.
      const lockCheck = await callLockoutApi('check');

      if (lockCheck?.locked) {
        const minutesLeft = Math.max(1, Math.ceil((new Date(lockCheck.lockedUntil).getTime() - Date.now()) / 60000));
        setError(`${t('accountLockedNote')} ${minutesLeft} ${t('minutesShortLabel')}.`);
        setLoading(false);
        return;
      }

      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        const failData = await callLockoutApi('record-failure');

        if (failData?.locked) {
          setError(`${t('accountLockedNote')} ${LOCK_DURATION_MINUTES} ${t('minutesShortLabel')}.`);
        } else {
          setError(t('wrongEmailOrPassword'));
        }
        setToast({ message: t('loginFailed'), type: 'error' });
        setLoading(false);
        return;
      }

        // Přihlášení se povedlo - vynulujeme počítadlo špatných pokusů.
      callLockoutApi('reset');

      let redirectTo: string | null = null;

      if (data.user) {
        // agreed_to_rules se z prohlížeče přímo nečte - je zavřený spolu
        // s ostatními údaji o účtu. Vydá ho funkce my_account(), a to jen
        // svému majiteli. Kdyby se tenhle sloupec nechal v selectu, celý
        // dotaz by skončil chybou a appka by při každém přihlášení
        // vyhodnotila profil jako neexistující - tedy pokus o založení
        // dalšího a odeslání na souhlas s pravidly dokola.
        const [{ data: existingProfile }, { data: accountRows }] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, rating_mode, content_preference')
            .eq('id', data.user.id)
            .maybeSingle(),
          supabase.rpc('my_account'),
        ]);

        const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;

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
        } else if (!account?.agreed_to_rules) {
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
    } catch {
      // Cokoliv neočekávaného (výpadek sítě, appka mimo provoz...) appku
      // už nikdy nenechá "viset" na tlačítku - vždy se aspoň ukáže chyba.
      setError(t('twoFactorGenericError'));
      setLoading(false);
    }
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
