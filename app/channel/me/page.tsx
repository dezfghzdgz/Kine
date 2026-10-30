'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { ensureOwnProfile } from '@/lib/ensureProfile';
import { useLanguage } from '@/lib/i18n';

function MyChannelRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        router.replace('/login');
        return;
      }

      // Pokud si profil ještě nikdy nevznikl (např. kvůli staršímu problému
      // s potvrzováním emailu), dotvoříme ho teď, ať kanál není "nenalezen".
      // Jméno z registrace, nikdy ne z e-mailu (lib/ensureProfile.ts).
      await ensureOwnProfile(supabase, authData.user);

      // Parametry z adresy (např. ?tab=posts&compose=text z mobilního menu
      // "+") se musí přenést i na skutečnou adresu kanálu, jinak appka
      // zapomene, že měla rovnou otevřít formulář na psaní.
      const query = searchParams.toString();
      router.replace(`/channel/${authData.user.id}${query ? `?${query}` : ''}`);
    })();
  }, [router, searchParams]);

  return <p style={{ color: 'var(--text-faint)' }}>{t('redirectingToChannel')}</p>;
}

export default function MyChannelRedirect() {
  return (
    <Suspense fallback={null}>
      <MyChannelRedirectInner />
    </Suspense>
  );
}
