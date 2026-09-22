'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

/**
 * Přihlášení webu v okně appky Kine do PC - opačný směr než /connect.
 *
 * Hráč je přihlášený v appce, ale web vložený do jejího okna ne. Appka si
 * přes /api/desktop/link vyžádá jednorázový token (token_hash "magic
 * linku", nic se neposílá e-mailem) a otevře tuhle stránku:
 *
 *     /connect/app?th=<token_hash>&next=/moje-videa
 *
 * Stránka z tokenu udělá běžnou relaci Supabase (verifyOtp) a přejde na
 * `next`. Token platí krátce a jen jednou, takže i kdyby ho někdo viděl,
 * za chvíli s ním nic neudělá. Když už je někdo přihlášený, jen se přejde
 * dál. `next` smí být jen cesta na tomhle webu (žádné cizí adresy).
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/connect')) return '/';
  return raw;
}

function ConnectAppInner() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const tokenHash = params.get('th') ?? '';
  const next = safeNext(params.get('next'));
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          if (!tokenHash) throw new Error(t('connectAppInvalid'));
          const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
          if (error) throw error;
        }
        // Celé načtení místo klientského přechodu - ať si menu i profil
        // hned vezmou novou relaci.
        window.location.replace(next);
      } catch (e) {
        setFailed((e as Error).message || t('connectAppFailed'));
      }
    })();
  }, [tokenHash, next, t]);

  return (
    <div className="form-container" style={{ maxWidth: 520 }}>
      <h1>{t('connectAppTitle')}</h1>
      <div className="panel">
        {!failed && <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('connectAppSigningIn')}</p>}
        {failed && (
          <>
            <p className="error-text" style={{ margin: 0 }}>{t('connectAppFailed')}</p>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>{failed}</p>
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="reaction-btn active" style={{ display: 'inline-flex', marginTop: 14, textDecoration: 'none' }}>
              {t('login')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConnectAppPage() {
  return (
    <Suspense fallback={null}>
      <ConnectAppInner />
    </Suspense>
  );
}
