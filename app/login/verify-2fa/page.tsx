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
  const [factorId, setFactorId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        router.replace('/login');
        return;
      }

      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const totpFactor = factorsData?.totp.find((f) => f.status === 'verified');

      if (!totpFactor) {
        // Nemá zapnuté 2FA - sem se vůbec neměl/a dostat, pošleme ho na hlavní stránku.
        router.replace('/');
        return;
      }

      setFactorId(totpFactor.id);
      setReady(true);
    })();
  }, [router]);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challengeData) {
      setError(t('twoFactorGenericError'));
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });

    if (verifyError) {
      setError(t('invalidTwoFactorCode'));
      setLoading(false);
      return;
    }

    setToast({ message: t('loginSuccess'), type: 'success' });
    setTimeout(() => {
      router.push('/');
      router.refresh();
    }, 700);
  }

  if (!ready) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <form className="form-container" onSubmit={handleVerify}>
        <h1>{t('twoFactorCodeTitle')}</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 4 }}>{t('enterCodeFromAppNote')}</p>
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
      </form>
    </>
  );
}
