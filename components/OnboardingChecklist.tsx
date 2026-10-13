'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, type DictKey } from '@/lib/i18n';
import UiIcon, { type UiIconName } from './UiIcon';

type Step = { key: DictKey; icon: UiIconName; done: boolean; href: string };

const DISMISS_KEY = 'kine-onboarding-dismissed';

/**
 * Úkoly pro nového tvůrce na hlavní stránce (jen kdo si v průvodci vybral
 * "chci tvořit"). Dřív byly natvrdo česky i v angličtině a s emoji - teď
 * přes překlady a s ikonami. Zmizí, když je všechno hotové nebo když ho
 * tvůrce skryje (pamatuje si to prohlížeč).
 */
export default function OnboardingChecklist() {
  const { t } = useLanguage();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    try {
      if (localStorage.getItem(DISMISS_KEY) === authData.user.id) {
        setDismissed(true);
        return;
      }
    } catch {
      // paměť prohlížeče nejde - seznam se ukáže
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
      { key: 'onboardUpload', icon: 'upload', done: (videoCount ?? 0) > 0, href: '/upload' },
      { key: 'onboardSpark', icon: 'bolt', done: (sparkCount ?? 0) > 0, href: '/upload' },
      { key: 'onboardPlaylist', icon: 'film', done: (playlistCount ?? 0) > 0, href: '/playlists' },
      { key: 'onboardProfile', icon: 'user', done: profileCustomized, href: '/settings#profile' },
      { key: 'onboardBanner', icon: 'image', done: hasBanner, href: '/settings#profile' },
      { key: 'onboardSocial', icon: 'link', done: hasSocialLink, href: '/settings#profile' },
    ]);
  }

  function handleDismiss() {
    supabase.auth.getUser().then(({ data }) => {
      try {
        if (data.user) localStorage.setItem(DISMISS_KEY, data.user.id);
      } catch {
        // nevadí - skryje se aspoň teď
      }
    });
    setDismissed(true);
  }

  if (dismissed || !steps) return null;

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <section className="panel onboarding-card" aria-label={t('onboardTitle')}>
      <div className="onboarding-head">
        <span className="onboarding-badge" aria-hidden="true">
          <UiIcon name="sparkle" size={18} />
        </span>
        <p className="onboarding-title">{t('onboardTitle')}</p>
        <span className="onboarding-count">{t('onboardProgress').replace('{done}', String(doneCount)).replace('{total}', String(steps.length))}</span>
        <button type="button" className="icon-btn onboarding-close" onClick={handleDismiss} aria-label={t('onboardHide')} title={t('onboardHide')}>
          <UiIcon name="close" size={16} />
        </button>
      </div>

      <div className="onboarding-progress" aria-hidden="true">
        <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div className="onboarding-steps">
        {steps.map((step) => (
          <Link key={step.key} href={step.href} className={`onboarding-step ${step.done ? 'done' : ''}`}>
            <span className="onboarding-step-check" aria-hidden="true">
              {step.done ? <UiIcon name="check" size={14} /> : <UiIcon name={step.icon} size={15} />}
            </span>
            <span className="onboarding-step-label">{t(step.key)}</span>
            {!step.done && <UiIcon name="chevronRight" size={15} className="onboarding-step-arrow" />}
          </Link>
        ))}
      </div>
    </section>
  );
}
