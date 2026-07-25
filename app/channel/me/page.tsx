'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

function MyChannelRedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        router.replace('/login');
        return;
      }

      // Pokud si profil ještě nikdy nevznikl (např. kvůli staršímu problému
      // s potvrzováním emailu), dotvoříme ho teď, ať kanál není "nenalezen".
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (!existingProfile) {
        const fallbackUsername = authData.user.email?.split('@')[0] ?? `user_${authData.user.id.slice(0, 6)}`;
        await supabase.from('profiles').insert({
          id: authData.user.id,
          username: fallbackUsername,
          display_name: fallbackUsername,
        });
      }

      // Parametry z adresy (např. ?tab=posts&compose=text z mobilního menu
      // "+") se musí přenést i na skutečnou adresu kanálu, jinak appka
      // zapomene, že měla rovnou otevřít formulář na psaní.
      const query = searchParams.toString();
      router.replace(`/channel/${authData.user.id}${query ? `?${query}` : ''}`);
    })();
  }, [router, searchParams]);

  return <p style={{ color: 'var(--text-faint)' }}>Přesměrovávám na tvůj kanál…</p>;
}

export default function MyChannelRedirect() {
  return (
    <Suspense fallback={null}>
      <MyChannelRedirectInner />
    </Suspense>
  );
}
