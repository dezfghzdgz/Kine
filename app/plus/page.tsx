'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { hasPlus, plusPriceLabel } from '@/lib/plus';

/**
 * Kine Plus - placená verze (lib/plus.ts).
 *
 * Zdarma: klipování v appce do PC bez omezení, klipy do 60 s, nahrání na
 * Kine ručně se stejnými pravidly jako každé video. Plus: automatické
 * nahrávání po hře, klipy až 5 minut, odznak PLUS.
 *
 * Platba přes Stripe (předplatné). Že proběhla, ví až webhook - proto
 * se po návratu s ?ok=1 chvíli může ukazovat ještě "free"; stránka se
 * pár sekund doptává.
 */
function PlusPageInner() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const justPaid = params.get('ok') === '1';
  const [me, setMe] = useState<{ plan: string | null; planUntil: string | null; loggedIn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = plusPriceLabel();

  async function load() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setMe({ plan: null, planUntil: null, loggedIn: false });
      return;
    }
    const { data: profile } = await supabase.from('profiles').select('plan, plan_until').eq('id', data.user.id).maybeSingle();
    setMe({ plan: profile?.plan ?? 'free', planUntil: profile?.plan_until ?? null, loggedIn: true });
  }

  useEffect(() => {
    load();
    if (!justPaid) return;
    // Webhook od Stripe může přijít o pár sekund později než návrat.
    const timers = [3000, 8000, 15000].map((ms) => setTimeout(load, ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPaid]);

  async function call(path: string) {
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || t('plusFailed'));
      window.location.href = body.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const active = me ? hasPlus(me.plan, me.planUntil) : false;
  const until = me?.planUntil ? new Date(me.planUntil).toLocaleDateString('cs-CZ') : null;

  return (
    <div className="form-container" style={{ maxWidth: 680 }}>
      <h1>Kine Plus</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>{t('plusIntro')}</p>

      <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <p className="panel-heading" style={{ marginBottom: 8 }}>{t('plusFreeTitle')}</p>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', lineHeight: 1.7, fontSize: 14 }}>
            <li>{t('plusFree1')}</li>
            <li>{t('plusFree2')}</li>
            <li>{t('plusFree3')}</li>
          </ul>
        </div>
        <div>
          <p className="panel-heading" style={{ marginBottom: 8, color: 'var(--brand)' }}>Kine Plus{price ? ` · ${price}` : ''}</p>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', lineHeight: 1.7, fontSize: 14 }}>
            <li>{t('plusPerk1')}</li>
            <li>{t('plusPerk2')}</li>
            <li>{t('plusPerk3')}</li>
          </ul>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        {me === null && <p style={{ margin: 0, color: 'var(--text-faint)' }}>{t('loading')}</p>}

        {me && !me.loggedIn && (
          <>
            <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('plusLoginFirst')}</p>
            <Link href="/login?next=/plus" className="reaction-btn active" style={{ display: 'inline-flex', marginTop: 12, textDecoration: 'none' }}>
              {t('login')}
            </Link>
          </>
        )}

        {me?.loggedIn && active && (
          <>
            <p style={{ margin: 0, color: 'var(--text)' }}>
              ✓ {until ? t('plusActiveUntil').replace('{date}', until) : t('plusActive')}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{t('plusActiveNote')}</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => call('/api/plus/portal')} disabled={busy}>
                {t('plusManage')}
              </button>
              <Link href="/download" className="reaction-btn" style={{ display: 'inline-flex', textDecoration: 'none' }}>
                {t('desktopAppLink')}
              </Link>
            </div>
          </>
        )}

        {me?.loggedIn && !active && (
          <>
            {justPaid ? (
              <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('plusWaitingPayment')}</p>
            ) : (
              <p style={{ margin: 0, color: 'var(--text-dim)' }}>{t('plusBuyIntro')}</p>
            )}
            <button type="button" onClick={() => call('/api/plus/checkout')} disabled={busy} style={{ marginTop: 14 }}>
              {busy ? t('loading') : price ? t('plusBuy').replace('{price}', price) : t('plusBuyNoPrice')}
            </button>
          </>
        )}

        {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}
      </div>

      <p style={{ color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.6 }}>{t('plusFinePrint')}</p>
    </div>
  );
}

export default function PlusPage() {
  return (
    <Suspense fallback={null}>
      <PlusPageInner />
    </Suspense>
  );
}
