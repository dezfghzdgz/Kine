'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase po kliknutí na odkaz z emailu automaticky vytvoří dočasnou
    // "recovery" session - jakmile se objeví, appka ví, že je bezpečné
    // ukázat formulář na nové heslo.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError('Hesla se neshodují.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    setTimeout(() => router.push('/'), 1500);
  }

  if (!ready) {
    return (
      <div className="form-container">
        <p style={{ color: 'var(--text-faint)' }}>
          Ověřuji odkaz na obnovení hesla… Pokud tahle stránka zůstane takhle déle než pár vteřin,
          odkaz z emailu už asi vypršel - vrať se na přihlášení a vyžádej si nový.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="form-container">
        <h1>Heslo změněno</h1>
        <p style={{ color: 'var(--text-dim)' }}>Za chvíli tě přesměrujeme na hlavní stránku…</p>
      </div>
    );
  }

  return (
    <form className="form-container" onSubmit={handleSubmit}>
      <h1>Nastav si nové heslo</h1>
      <input
        type="password"
        placeholder="Nové heslo (min. 6 znaků)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={6}
        required
      />
      <input
        type="password"
        placeholder="Zopakuj nové heslo"
        value={passwordConfirm}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        minLength={6}
        required
      />
      {error && <p className="error-text">{error}</p>}
      <button type="submit" disabled={saving}>
        {saving ? 'Ukládám…' : 'Nastavit nové heslo'}
      </button>
    </form>
  );
}
