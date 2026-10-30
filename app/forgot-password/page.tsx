'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

/**
 * Zapomenuté heslo: Supabase pošle e-mail s odkazem na /reset-password.
 * Odpověď je stejná, ať účet s e-mailem existuje, nebo ne (nejde tak
 * zjišťovat, kdo je na Kine registrovaný). Texty ve všech jazycích Kine.
 */
export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      // Supabase pustí jeden e-mail za minutu - ať je jasné proč (ne anglická hláška ze serveru).
      const tooFast = resetError.status === 429 || /rate|seconds|security purposes|too many/i.test(resetError.message ?? '');
      setError(tooFast ? t('forgotPwTooFast') : t('forgotPwFailed'));
      return;
    }
    setSent(true);
  }

  return (
    <form className="form-container" onSubmit={handleSubmit}>
      <h1>{t('forgotPwTitle')}</h1>

      {sent ? (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>{t('forgotPwSent')}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            {t('forgotPwOtherEmail')}
          </button>
        </>
      ) : (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>{t('forgotPwIntro')}</p>
          <input
            type="email"
            placeholder={t('email')}
            aria-label={t('email')}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={loading}>
            {loading ? t('forgotPwSending') : t('forgotPwSend')}
          </button>
        </>
      )}

      <Link href="/login" style={{ color: 'var(--text-faint)', fontSize: 13 }}>
        ← {t('forgotPwBack')}
      </Link>
    </form>
  );
}
