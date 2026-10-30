'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

// Krátký "přesměrovávač" - zmínky @jméno v komentářích odkazují sem,
// appka tu najde skutečné ID profilu podle uživatelského jména a
// přesměruje na jeho kanál.
export default function UsernameRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const [notFound, setNotFound] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id')
      .eq('username', params.username)
      .maybeSingle()
      .then(({ data }) => {
        if (data) router.replace(`/channel/${data.id}`);
        else setNotFound(true);
      });
  }, [params.username]);

  if (notFound) return <p>{t('userNotFound').replace('{name}', String(params.username ?? ''))}</p>;
  return <p style={{ color: 'var(--text-faint)' }}>{t('redirecting')}</p>;
}
