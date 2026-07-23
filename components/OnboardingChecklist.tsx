'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Step = { label: string; done: boolean; href: string };

export default function OnboardingChecklist() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    if (localStorage.getItem('kine-onboarding-dismissed') === authData.user.id) {
      setDismissed(true);
      return;
    }

    const [{ count: videoCount }, { count: sparkCount }, { count: playlistCount }, profileRes] = await Promise.all([
      supabase.from('videos').select('*', { count: 'exact', head: true }).eq('owner_id', authData.user.id),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', authData.user.id)
        .lte('duration_seconds', 120)
        .not('height', 'is', null)
        .not('width', 'is', null),
      supabase.from('playlists').select('*', { count: 'exact', head: true }).eq('owner_id', authData.user.id).eq('is_system', false),
      supabase.from('profiles').select('avatar_url, bio, banner_url, social_links, viewer_type').eq('id', authData.user.id).single(),
    ]);

    // Kdo appku otevřel jen na koukání, tenhle seznam úkolů pro tvůrce vidět nemusí
    if (profileRes.data?.viewer_type !== 'creator') return;

    const profileCustomized = !!(profileRes.data?.avatar_url || profileRes.data?.bio);
    const hasBanner = !!profileRes.data?.banner_url;
    const hasSocialLink = Array.isArray(profileRes.data?.social_links) && profileRes.data.social_links.length > 0;

    setSteps([
      { label: 'Nahraj první video', done: (videoCount ?? 0) > 0, href: '/upload' },
      { label: 'Zkus nahrát Spark (krátké vertikální video)', done: (sparkCount ?? 0) > 0, href: '/upload' },
      { label: 'Vytvoř playlist', done: (playlistCount ?? 0) > 0, href: '/playlists' },
      { label: 'Uprav si profil (fotka nebo popis)', done: profileCustomized, href: '/settings' },
      { label: 'Nastav banner kanálu', done: hasBanner, href: '/settings' },
      { label: 'Přidej odkaz na sociální síť', done: hasSocialLink, href: '/settings' },
    ]);
  }

  function handleDismiss() {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) localStorage.setItem('kine-onboarding-dismissed', data.user.id);
    });
    setDismissed(true);
  }

  if (dismissed || !steps) return null;

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <p className="panel-heading" style={{ margin: 0 }}>Vítej na Kine 👋</p>
        <button onClick={handleDismiss} style={{ background: 'none', color: 'var(--text-faint)', padding: 4 }}>✕</button>
      </div>

      <div style={{ height: 6, background: 'var(--border)', borderRadius: 999, marginBottom: 14, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%', width: `${(doneCount / steps.length) * 100}%`,
            background: 'var(--text)', transition: 'width 0.2s ease',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step) => (
          <Link
            key={step.label}
            href={step.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
              color: step.done ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: step.done ? 'line-through' : 'none',
            }}
          >
            <span>{step.done ? '✅' : '⬜'}</span>
            {step.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
