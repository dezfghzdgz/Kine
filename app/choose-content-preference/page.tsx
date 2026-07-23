'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function ChooseContentPreferencePage() {
  const router = useRouter();
  const { t } = useLanguage();
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

  async function choose(pref: 'short' | 'long') {
    setSaving(true);
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      await supabase.from('profiles').update({ content_preference: pref }).eq('id', authData.user.id);
    }
    router.push('/');
    router.refresh();
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>…</p>;

  const cardStyle: React.CSSProperties = {
    width: 200, minWidth: 200, maxWidth: 200, flex: '0 0 auto',
    overflow: 'hidden', boxSizing: 'border-box',
    cursor: 'pointer', background: 'var(--panel-raised)', color: 'var(--text)', marginTop: 0,
  };

  return (
    <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
      <h1>{t('contentPrefTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 28 }}>
        {t('contentPrefIntro')}
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => choose('long')} disabled={saving} className="panel" style={cardStyle}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎬</div>
          <p style={{ fontWeight: 600, margin: 0 }}>{t('longerVideosLabel')}</p>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>{t('longVideosDesc')}</p>
        </button>

        <button onClick={() => choose('short')} disabled={saving} className="panel" style={cardStyle}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚡</div>
          <p style={{ fontWeight: 600, margin: 0 }}>Sparks</p>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>{t('sparksDesc')}</p>
        </button>
      </div>
    </div>
  );
}
