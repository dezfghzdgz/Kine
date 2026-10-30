'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

/** Jak dlouho čekat na ověření odkazu z e-mailu, než se ukáže „odkaz vypršel“. */
const VERIFY_TIMEOUT_MS = 6000;

/**
 * Nové heslo po kliknutí na odkaz z e-mailu (app/forgot-password).
 * Supabase z odkazu vytvoří dočasné přihlášení ("recovery") - teprve pak
 * se ukáže formulář. Texty ve všech jazycích Kine.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase po kliknutí na odkaz z e-mailu sám vytvoří dočasnou "recovery" session -
    // jakmile se objeví, je bezpečné ukázat formulář na nové heslo.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const timer = setTimeout(() => setExpired(true), VERIFY_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError(t('passwordsDontMatch'));
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      const msg = updateError.message ?? '';
      if (/different from the old|same password/i.test(msg)) setError(t('resetPwSameAsOld'));
      else if (/weak|at least|characters|pwned|leaked/i.test(msg)) setError(t('resetPwWeak'));
      else if (/session|expired|jwt|not authenticated/i.test(msg)) setError(t('resetPwExpired'));
      else setError(t('resetPwFailed'));
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/'), 1500);
  }

  if (!ready) {
    return (
      <div className="form-container">
        {expired ? (
          <>
            <h1>{t('resetPwExpiredTitle')}</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>{t('resetPwExpired')}</p>
            <Link href="/forgot-password">{t('resetPwRequestNew')}</Link>
          </>
        ) : (
          <p style={{ color: 'var(--text-faint)' }} role="status">
            {t('resetPwVerifying')}
          </p>
        )}
      </div>
    );
  }

  if (done) {
    return (
      <div className="form-container">
        <h1>{t('resetPwDoneTitle')}</h1>
        <p style={{ color: 'var(--text-dim)' }}>{t('resetPwDoneText')}</p>
      </div>
    );
  }

  return (
    <form className="form-container" onSubmit={handleSubmit}>
      <h1>{t('resetPwTitle')}</h1>
      <input
        type="password"
        placeholder={t('resetPwNew')}
        aria-label={t('resetPwNew')}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={6}
        required
      />
      <input
        type="password"
        placeholder={t('resetPwRepeat')}
        aria-label={t('resetPwRepeat')}
        autoComplete="new-password"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        minLength={6}
        required
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={saving}>
        {saving ? t('resetPwSaving') : t('resetPwSave')}
      </button>
    </form>
  );
}
