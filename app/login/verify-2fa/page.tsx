'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Toast, { ToastType } from '@/components/Toast';
import { useLanguage } from '@/lib/i18n';

export default function Verify2FAPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    const pendingEmail = sessionStorage.getItem('kine-pending-2fa-email');
    if (!pendingEmail) {
      router.replace('/login');
      return;
    }
    setEmail(pendingEmail);
    setReady(true);
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setError(null);
    setLoading(true);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });

    setLoading(false);

    if (verifyError) {
      setError(t('invalidTwoFactorCode'));
      return;
    }

    sessionStorage.removeItem('kine-pending-2fa-email');
    setToast({ message: t('loginSuccess'), type: 'success' });
    setTimeout(() => {
      router.push('/');
      router.refresh();
    }, 700);
  }

  async function handleResend() {
    if (!email) return;
    setResending(true);
    await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setResending(false);
    setToast({ message: t('twoFactorCodeResentToast'), type: 'success' });
  }

  if (!ready) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <form className="form-container" onSubmit={handleVerify}>
        <h1>{t('twoFactorCodeTitle')}</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 4 }}>
          {t('enterEmailCodeNote')} {email}
        </p>
        <input
          type="text"
          inputMode="numeric"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          maxLength={6}
          autoFocus
          required
        />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={loading || code.length !== 6}>
          {loading ? t('verifyingLabel') : t('verifyCodeButton')}
        </button>
        <button
          type="button"
          onClick={handleResend}
          disabled={resending}
          style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 13, textDecoration: 'underline', padding: 0 }}
        >
          {resending ? t('preparingLabel') : t('resendCodeButton')}
        </button>
      </form>
    </>
  );
}
