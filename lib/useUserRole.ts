'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export function useUserRole() {
  const [role, setRole] = useState<'user' | 'moderator' | 'admin' | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Administrátorská práva má appka uložená zvlášť ve sloupci is_admin -
  // podle něj se řídí stránky pod /admin.
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      setUserId(authData.user.id);

      // Sloupce role a is_admin si z prohlížeče přečíst nejde - byly by
      // čitelné i o cizích lidech (viz supabase-migration-privacy-fixes).
      // Funkce my_account vrací schválně jen řádek volajícího.
      const { data } = await supabase.rpc('my_account');
      const account = Array.isArray(data) ? data[0] : data;

      setRole((account?.role as 'user' | 'moderator' | 'admin') ?? 'user');
      setIsAdmin(!!account?.is_admin);
    })();
  }, []);

  // is_admin schválně NEdělá z člověka moderátora: mazání videí a komentářů
  // se na serveru řídí jen sloupcem role, takže by se mu jinak ukazovala
  // tlačítka, která by mu server stejně odmítl.
  const isModerator = role === 'moderator' || role === 'admin';

  return { role, userId, isModerator, isAdmin };
}
