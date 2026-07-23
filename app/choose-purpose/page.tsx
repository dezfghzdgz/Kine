'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function ChoosePurposePage() {
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

  async function choose(type: 'viewer' | 'creator') {
    setSaving(true);
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      await supabase.from('profiles').update({ viewer_type: type }).eq('id', authData.user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('rating_mode')
        .eq('id', authData.user.id)
        .single();

      if (!profile?.rating_mode) {
        router.push('/choose-rating-mode');
        return;
      }
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
      <h1>{t('purposeTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 28 }}>
        {t('purposeIntro')}
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => choose('viewer')} disabled={saving} className="panel" style={cardStyle}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🍿</div>
          <p style={{ fontWeight: 600, margin: 0 }}>{t('wantToWatch')}</p>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>{t('wantToWatchDesc')}</p>
        </button>

        <button onClick={() => choose('creator')} disabled={saving} className="panel" style={cardStyle}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🎬</div>
          <p style={{ fontWeight: 600, margin: 0 }}>{t('wantToCreate')}</p>
          <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>{t('wantToCreateDesc')}</p>
        </button>
      </div>
    </div>
  );
}
