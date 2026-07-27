'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export function useUserRole() {
  const [role, setRole] = useState<'user' | 'moderator' | 'admin' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      setUserId(authData.user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', authData.user.id)
        .maybeSingle();

      setRole((profile?.role as 'user' | 'moderator' | 'admin') ?? 'user');
    })();
  }, []);

  const isModerator = role === 'moderator' || role === 'admin';

  return { role, userId, isModerator };
}
