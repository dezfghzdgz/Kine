'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

/**
 * Připojení počítače k účtu - sem appka Kine do PC pošle prohlížeč.
 *
 * ?port=<port>&state=<náhodný řetězec>: appka poslouchá na
 * http://127.0.0.1:<port>. Po kliknutí si stránka vyžádá jednorázový
 * token (/api/desktop/link) a pošle ho appce. Kdyby prohlížeč na
 * 127.0.0.1 nepustil (přísnější nastavení sítě), nabídne se odkaz
 * kine://link?…, který appku otevře přímo. Token je jednorázový a platí
 * krátce, takže i kdyby ho někdo zachytil, nic s ním za chvíli neudělá.
 */
function ConnectInner() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const port = Number(params.get('port'));
  const state = params.get('state') ?? '';
  const valid = Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[0-9a-f]{16,64}$/i.test(state);

  const [session, setSession] = useState<{ token: string; username: string } | null | undefined>(undefined);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'fallback' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  const nextUrl = useMemo(() => `/login?next=${encodeURIComponent(`/connect?port=${port}&state=${state}`)}`, [port, state]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const s = data.session;
      if (!s) {
        setSession(null);
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('username').eq('id', s.user.id).maybeSingle();
      setSession({ token: s.access_token, username: profile?.username ?? s.user.email?.split('@')[0] ?? 'kine' });
    });
  }, []);

  async function connect() {
    if (!session) return;
    setPhase('working');
    setError(null);
    try {
      const res = await fetch('/api/desktop/link', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token_hash) throw new Error(body.error || t('connectFailed'));
      const tokenHash: string = body.token_hash;
      const link = `kine://link?th=${encodeURIComponent(tokenHash)}&state=${encodeURIComponent(state)}`;
      setDeepLink(link);

      // Nejdřív rovnou appce na 127.0.0.1 - bez dalšího klikání.
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const appRes = await fetch(`http://127.0.0.1:${port}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token_hash: tokenHash, state }),
          signal: controller.signal,
          // Chrome: výslovně povolit požadavek ze zabezpečené stránky na loopback.
          ...({ targetAddressSpace: 'loopback' } as Record<string, unknown>),
        });
        clearTimeout(timer);
        const appBody = await appRes.json().catch(() => ({}));
        if (!appRes.ok || !appBody.ok) throw new Error(appBody.error || 'app');
        setPhase('done');
        return;
      } catch {
        // Prohlížeč nepustil na 127.0.0.1 - zkusí se odkaz kine://.
        setPhase('fallback');
        window.location.href = link;
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  if (!valid) {
    return (
      <div className="form-container" style={{ maxWidth: 520 }}>
        <h1>{t('connectTitle')}</h1>
        <p style={{ color: 'var(--text-dim)' }}>{t('connectInvalid')}</p>
        <Link href="/download">{t('desktopAppLink')}</Link>
      </div>
    );
  }

  return (
    <div className="form-container" style={{ maxWidth: 520 }}>
      <h1>{t('connectTitle')}</h1>
      <div className="panel">
        {session === undefined && <p style={{ margin: 0, color: 'var(--text-faint)' }}>{t('loading')}</p>}

        {session === null && (
          <>
            <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('connectLoginFirst')}</p>
            <Link href={nextUrl} className="reaction-btn active" style={{ display: 'inline-flex', marginTop: 14, textDecoration: 'none' }}>
              {t('login')}
            </Link>
          </>
        )}

        {session && phase === 'idle' && (
          <>
            <p style={{ margin: 0, color: 'var(--text)' }}>{t('connectIntro').replace('{username}', `@${session.username}`)}</p>
            <button type="button" onClick={connect} style={{ marginTop: 14 }}>
              {t('connectButton')}
            </button>
          </>
        )}

        {phase === 'working' && <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('connectWorking')}</p>}

        {phase === 'done' && (
          <>
            <p style={{ margin: 0, color: 'var(--text)' }}>{t('connectDone')}</p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{t('connectDoneNote')}</p>
          </>
        )}

        {phase === 'fallback' && deepLink && (
          <>
            <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('connectFallback')}</p>
            <a href={deepLink} className="reaction-btn active" style={{ display: 'inline-flex', marginTop: 14, textDecoration: 'none' }}>
              {t('connectOpenApp')}
            </a>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="error-text" style={{ margin: 0 }}>{error ?? t('connectFailed')}</p>
            <button type="button" onClick={connect} style={{ marginTop: 14 }}>
              {t('connectButton')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <ConnectInner />
    </Suspense>
  );
}
