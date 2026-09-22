'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { allPriceLabels, hasPlus, normalizePlan, type PaidTier } from '@/lib/plus';

/**
 * Předplatné Kine - tři varianty (lib/plus.ts):
 *  Kine Plus (web: odznak, vyšší limit nahrávání), Klipy Plus (appky do PC:
 *  automatické nahrávání, klipy až 5 minut) a obojí. Základ zůstává zdarma
 *  a bez omezení.
 *
 * Stránka je stavěná jako nabídka pro zákazníka: krátký titulek s tím, co
 * člověk dostane, tři karty s cenou a výhodami (obojí zvýrazněné jako
 * nejvýhodnější), srovnávací tabulka se základem zdarma a odpovědi na
 * otázky, které si lidi kladou před zaplacením. Ceny přicházejí
 * z prostředí (NEXT_PUBLIC_PLUS_*_PRICE_LABEL); bez nich je varianta
 * "Brzy" - nic se nevymýšlí.
 *
 * Platba přes Stripe (předplatné). Že proběhla, ví až webhook - proto se
 * po návratu s ?ok=1 chvíli může ukazovat ještě "free"; stránka se pár
 * sekund doptává. Změna varianty a zrušení jde přes portál Stripe.
 */
function TierIcon({ tier }: { tier: PaidTier }) {
  const common = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (tier === 'kine') {
    // odznak
    return (
      <svg {...common}>
        <path d="M12 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.9l-5.2 2.7 1-5.8L3.5 8.7l5.9-.9z" />
      </svg>
    );
  }
  if (tier === 'clips') {
    // svorky klipovače
    return (
      <svg {...common}>
        <path d="M8 4H4v16h4M16 4h4v16h-4" />
        <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3l1.9 3.9 4.3.6-3.1 3 .7 4.3L12 12.8l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
      <path d="M5 19h14" />
    </svg>
  );
}

function Check({ off = false }: { off?: boolean }) {
  if (off) return <span className="plus-cell-off" aria-label="–">–</span>;
  return (
    <svg className="plus-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function PlusPageInner() {
  const { t, lang } = useLanguage();
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
  const until = me?.planUntil ? new Date(me.planUntil).toLocaleDateString(lang === 'en' ? 'en-GB' : lang) : null;
  const planName = (p: string) => (p === 'kine' ? t('plusTierKine') : p === 'clips' ? t('plusTierClips') : p === 'all' || p === 'plus' ? t('plusTierAll') : t('plusFreeTitle'));

  const tiers: { tier: PaidTier; title: string; sub: string; perks: string[]; featured: boolean }[] = [
    { tier: 'kine', title: t('plusTierKine'), sub: t('plusTierKineSub'), perks: [t('plusTierKine1'), t('plusTierKine2'), t('plusTierKine3')], featured: false },
    { tier: 'all', title: t('plusTierAll'), sub: t('plusTierAllSub'), perks: [t('plusTierAll1'), t('plusTierAll2'), t('plusTierAll3')], featured: true },
    { tier: 'clips', title: t('plusTierClips'), sub: t('plusTierClipsSub'), perks: [t('plusTierClips1'), t('plusTierClips2'), t('plusTierClips3')], featured: false },
  ];

  const owns = (tier: PaidTier) => active && (plan === tier || plan === 'all' || plan === 'plus');

  // Tlačítko podle stavu: nepřihlášený -> přihlásit, moje -> ✓, jinak koupit (nebo "Brzy").
  const cta = (tier: PaidTier, price: string | null) => {
    if (owns(tier)) return <span className="plus-mine">✓ {t('plusCurrent')}</span>;
    // Bez ceny (Stripe ještě není nastavený) říká "Brzy" už cenovka - tlačítko by to jen opakovalo.
    if (!price) return null;
    if (me && !me.loggedIn) {
      return (
        <Link href="/login?next=/plus" className="reaction-btn plus-cta">
          {t('plusSignInToGet')}
        </Link>
      );
    }
    if (active) return null;
    return (
      <button type="button" className="plus-cta" onClick={() => call('/api/plus/checkout', tier)} disabled={busy !== null}>
        {busy === tier ? t('loading') : t('plusChoose').replace('{price}', price)}
      </button>
    );
  };

  const rows: { label: string; cells: (boolean | string)[] }[] = [
    { label: t('plusCmpClipping'), cells: [true, true, true, true] },
    { label: t('plusCmpClipLength'), cells: ['60 s', '60 s', '5 min', '5 min'] },
    { label: t('plusCmpManualUpload'), cells: [true, true, true, true] },
    { label: t('plusCmpAutoUpload'), cells: [false, false, true, true] },
    { label: t('plusCmpBadge'), cells: [false, true, false, true] },
    { label: t('plusCmpLimit'), cells: ['1×', '3×', '1×', '3×'] },
    { label: t('plusCmpSupport'), cells: [false, true, true, true] },
  ];
  const faq = [1, 2, 3, 4].map((n) => ({ q: t(`plusFaq${n}Q` as 'plusFaq1Q'), a: t(`plusFaq${n}A` as 'plusFaq1A') }));

  return (
    <div className="form-container plus-page" style={{ maxWidth: 980 }}>
      <header className="plus-hero">
        <span className="plus-eyebrow">PLUS</span>
        <h1>{t('plusHeroTitle')}</h1>
        <p>{t('plusHeroText')}</p>
      </header>

      {me?.loggedIn && active && (
        <div className="panel plus-status">
          <div>
            <p style={{ margin: 0, color: 'var(--text)', fontWeight: 600 }}>
              ✓ {until ? t('plusYourPlanUntil').replace('{plan}', planName(plan)).replace('{date}', until) : t('plusYourPlan').replace('{plan}', planName(plan))}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>
              {t('plusChangeHint')} {plan !== 'kine' ? t('plusActiveNote') : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => call('/api/plus/portal')} disabled={busy !== null}>
              {t('plusManage')}
            </button>
            <Link href="/download" className="reaction-btn" style={{ display: 'inline-flex', textDecoration: 'none' }}>
              {t('desktopAppLink')}
            </Link>
          </div>
        </div>
      )}
      {me?.loggedIn && !active && justPaid && <p className="panel" style={{ margin: '0 0 14px', color: 'var(--text-dim)' }}>{t('plusWaitingPayment')}</p>}

      <div className="plus-grid">
        {tiers.map(({ tier, title, sub, perks, featured }) => {
          const price = prices[tier];
          const mine = owns(tier);
          return (
            <div key={tier} className={`panel plus-card ${featured ? 'featured' : ''} ${mine ? 'mine' : ''}`}>
              {featured && <span className="plus-ribbon">{t('plusBestValue')}</span>}
              <div className="plus-card-head">
                <span className="plus-tier-icon">
                  <TierIcon tier={tier} />
                </span>
                <div>
                  <p className="plus-tier-name">{title}</p>
                  <p className="plus-tier-sub">{sub}</p>
                </div>
              </div>
              <div className="plus-price">
                {price ? (
                  <>
                    <span className="plus-price-value">{price}</span>
                    <span className="plus-price-per">{t('plusMonthly')}</span>
                  </>
                ) : (
                  <span className="plus-price-soon">{t('plusNotAvailable')}</span>
                )}
              </div>
              <ul className="plus-perks">
                {perks.map((p) => (
                  <li key={p}>
                    <Check />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <div className="plus-card-foot">{cta(tier, price)}</div>
            </div>
          );
        })}
      </div>

      {error && <p className="error-text" style={{ marginTop: 10 }}>{error}</p>}

      <section className="panel plus-compare">
        <p className="panel-heading" style={{ marginBottom: 4 }}>{t('plusCompareTitle')}</p>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)' }}>{t('plusCompareText')}</p>
        <div className="plus-table-wrap">
          <table className="plus-table">
            <thead>
              <tr>
                <th />
                <th>{t('plusFreeTitle')}</th>
                <th>{t('plusTierKine')}</th>
                <th>{t('plusTierClips')}</th>
                <th className="featured">{t('plusTierAll')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, i) => (
                    <td key={i} className={i === 3 ? 'featured' : ''}>
                      {typeof cell === 'boolean' ? <Check off={!cell} /> : <span className="plus-cell-text">{cell}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="plus-faq">
        <p className="panel-heading">{t('plusFaqTitle')}</p>
        {faq.map((item) => (
          <details key={item.q} className="plus-faq-item">
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </section>

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
