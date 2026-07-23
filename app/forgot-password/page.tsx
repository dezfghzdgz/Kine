'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <form className="form-container" onSubmit={handleSubmit}>
      <h1>Obnovit heslo</h1>

      {sent ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          Pokud u nás máš účet s tímhle emailem, poslali jsme ti odkaz na obnovení hesla.
          Zkontroluj si schránku (i spam).
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>
            Napiš email, na který jsi se registroval/a - pošleme ti odkaz na nastavení nového hesla.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <p className="error-text">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Odesílám…' : 'Poslat odkaz na obnovení'}
          </button>
        </>
      )}

      <Link href="/login" style={{ color: 'var(--text-faint)', fontSize: 13 }}>
        ← Zpátky na přihlášení
      </Link>
    </form>
  );
}
