'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { allPriceLabels, hasPlus, normalizePlan, type PaidTier } from '@/lib/plus';

/**
 * Předplatné Kine - tři varianty (lib/plus.ts):
 *  Kine Plus (web: odznak, vyšší limit nahrávání), Klipy Plus (appka do PC:
 *  automatické nahrávání, klipy až 5 minut) a obojí. Základ zůstává zdarma
 *  a bez omezení.
 *
 * Platba přes Stripe (předplatné). Že proběhla, ví až webhook - proto se
 * po návratu s ?ok=1 chvíli může ukazovat ještě "free"; stránka se pár
 * sekund doptává. Změna varianty a zrušení jde přes portál Stripe.
 */
function PlusPageInner() {
  const { t } = useLanguage();
  const params = useSearchParams();
  const justPaid = params.get('ok') === '1';
  const [me, setMe] = useState<{ plan: string | null; planUntil: string | null; loggedIn: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prices = allPriceLabels();

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

  async function call(path: string, tier?: PaidTier) {
    setBusy(tier ?? 'portal');
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' },
        body: tier ? JSON.stringify({ tier }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || t('plusFailed'));
      window.location.href = body.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const active = me ? hasPlus(me.plan, me.planUntil) : false;
  const plan = active ? normalizePlan(me?.plan) : 'free';
  const until = me?.planUntil ? new Date(me.planUntil).toLocaleDateString('cs-CZ') : null;
  const planName = (p: string) => (p === 'kine' ? t('plusTierKine') : p === 'clips' ? t('plusTierClips') : p === 'all' || p === 'plus' ? t('plusTierAll') : t('plusFreeTitle'));

  const tiers: { tier: PaidTier; title: string; sub: string; perks: string[]; highlight: boolean }[] = [
    { tier: 'kine', title: t('plusTierKine'), sub: t('plusTierKineSub'), perks: [t('plusTierKine1'), t('plusTierKine2'), t('plusTierKine3')], highlight: false },
    { tier: 'clips', title: t('plusTierClips'), sub: t('plusTierClipsSub'), perks: [t('plusTierClips1'), t('plusTierClips2'), t('plusTierClips3')], highlight: false },
    { tier: 'all', title: t('plusTierAll'), sub: t('plusTierAllSub'), perks: [t('plusTierAll1'), t('plusTierAll2')], highlight: true },
  ];

  const owns = (tier: PaidTier) => active && (plan === tier || plan === 'all' || plan === 'plus');

  return (
    <div className="form-container" style={{ maxWidth: 860 }}>
      <h1>{t('plusPageTitle')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 15, lineHeight: 1.6, marginTop: -6 }}>{t('plusIntro')}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {tiers.map(({ tier, title, sub, perks, highlight }) => {
          const price = prices[tier];
          const mine = owns(tier);
          return (
            <div
              key={tier}
              className="panel"
              style={{
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                borderColor: highlight || mine ? 'rgba(var(--brand-rgb), 0.55)' : undefined,
                boxShadow: highlight ? '0 0 0 3px var(--brand-soft)' : undefined,
              }}
            >
              <div>
                <p className="panel-heading" style={{ margin: 0, color: 'var(--brand)' }}>{title}</p>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-faint)' }}>{sub}</p>
              </div>
              <p style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{price ?? '—'}</p>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', lineHeight: 1.7, fontSize: 14, flex: 1 }}>
                {perks.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {mine ? (
                <span style={{ color: 'var(--brand)', fontSize: 14, fontWeight: 600 }}>✓ {t('plusCurrent')}</span>
              ) : me?.loggedIn && !active ? (
                <button type="button" onClick={() => call('/api/plus/checkout', tier)} disabled={busy !== null || !price}>
                  {busy === tier ? t('loading') : price ? t('plusChoose').replace('{price}', price) : t('plusNotAvailable')}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <p className="panel-heading" style={{ marginBottom: 8 }}>{t('plusFreeTitle')}</p>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-dim)', lineHeight: 1.7, fontSize: 14 }}>
          <li>{t('plusFree1')}</li>
          <li>{t('plusFree2')}</li>
          <li>{t('plusFree3')}</li>
        </ul>
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
              ✓ {until ? t('plusYourPlanUntil').replace('{plan}', planName(plan)).replace('{date}', until) : t('plusYourPlan').replace('{plan}', planName(plan))}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
              {t('plusChangeHint')} {plan !== 'kine' ? t('plusActiveNote') : ''}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => call('/api/plus/portal')} disabled={busy !== null}>
                {t('plusManage')}
              </button>
              <Link href="/download" className="reaction-btn" style={{ display: 'inline-flex', textDecoration: 'none' }}>
                {t('desktopAppLink')}
              </Link>
            </div>
          </>
        )}

        {me?.loggedIn && !active && (
          <p style={{ margin: 0, color: 'var(--text-dim)' }}>{justPaid ? t('plusWaitingPayment') : t('plusBuyIntro')}</p>
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
