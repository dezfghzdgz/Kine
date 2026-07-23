'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function MyChannelRedirect() {
  const router = useRouter();

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

      router.replace(`/channel/${authData.user.id}`);
    })();
  }, [router]);

  return <p style={{ color: 'var(--text-faint)' }}>Přesměrovávám na tvůj kanál…</p>;
}
