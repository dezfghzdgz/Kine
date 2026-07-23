'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

// Tahle stránka je záměrně vždy jen v angličtině (bez ohledu na jazyk appky),
// stejně jako Podmínky/Ochrana údajů/Pravidla - je to právně citlivý obsah.
export default function AgreeToRulesPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace('/login');
        return;
      }
      setChecking(false);
    });
  }, [router]);

  async function handleAgree() {
    setSaving(true);
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      await supabase
        .from('profiles')
        .update({ agreed_to_rules: true, agreed_to_rules_at: new Date().toISOString() })
        .eq('id', authData.user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('viewer_type')
        .eq('id', authData.user.id)
        .single();

      if (!profile?.viewer_type) {
        router.push('/choose-purpose');
        return;
      }

      router.push('/');
      router.refresh();
    }
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>…</p>;

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <h1>Before you start, confirm our rules</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 20 }}>
        Kine is built on free speech - we want everyone to be able to say what they think.
        But zero tolerance and an immediate account ban apply to a few serious things
        (e.g. child exploitation material, real threats, documenting illegal activity).
      </p>

      <div className="panel" style={{ textAlign: 'left', marginBottom: 20, maxHeight: 220, overflowY: 'auto' }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          In short: satire, controversial opinions and dark humor are fine here - don't
          like an opinion? Downvote it or rate it low, don't ask for it to be removed.
          Strictly forbidden: pornography, child exploitation material, real threats of
          violence, doxxing, non-consensual intimate content, and documenting/promoting
          illegal activity.
        </p>
        <Link href="/rules" target="_blank" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>
          Read the full rules →
        </Link>
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--text-faint)', marginBottom: 20 }}>
        By using the app you confirm you are at least 13 years old and agree to the{' '}
        <Link href="/terms" target="_blank" style={{ color: 'var(--text)' }}>Terms of Service</Link> and{' '}
        <Link href="/privacy" target="_blank" style={{ color: 'var(--text)' }}>Privacy Policy</Link>.
      </p>

      <button onClick={handleAgree} disabled={saving} style={{ width: '100%' }}>
        {saving ? 'Saving…' : "I agree, let's continue"}
      </button>
    </div>
  );
}
