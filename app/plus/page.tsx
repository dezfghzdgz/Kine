'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { allPriceLabels, formatPlusAmount, hasPlus, normalizePlan, shownPriceFromLabel, type PaidTier, type ShownCurrency } from '@/lib/plus';
import { PAYMENTS_ENABLED } from '@/lib/payments';
import ComingSoon from '@/components/ComingSoon';
import { operatorLine } from '@/lib/operator';

/**
 * Předplatné Kine - tři varianty (lib/plus.ts):
 *  Kine Plus (web: odznak, vyšší limit nahrávání), Klipy Plus (appky do PC:
 *  automatické nahrávání, klipy až 5 minut) a obojí. Základ zůstává zdarma
 *  a bez omezení.
 *
 * Stránka je stavěná jako nabídka pro zákazníka: krátký titulek, tři karty
 * s cenou (obojí zvýrazněné jako nejvýhodnější), čtyři dlaždice „co Plus
 * přidá“ s velkými čísly a pruh „vždy zdarma“ - podrobná tabulka je až pod
 * rozbalením, ať stránka na první pohled nevypadá složitě.
 *
 * Ceny jsou rovnou ze Stripe (/api/plus/prices, lib/plusPrices.ts) a jen
 * v eurech, v USA v dolarech - koruny se neukazují nikdy. Než se načtou
 * (nebo když Stripe neodpoví), poslouží eurová část starého popisku
 * z Vercelu; bez ceny je varianta „Brzy“ - nic se nevymýšlí.
 *
 * Platba přes Stripe (předplatné). Že proběhla, ví až webhook - proto se
 * po návratu s ?ok=1 chvíli může ukazovat ještě "free"; stránka se pár
 * sekund doptává. Změna varianty a zrušení jde přes portál Stripe.
 */

type LivePrices = { enabled: true; ok: boolean; currency: ShownCurrency; tiers: Record<PaidTier, { eur: number | null; usd: number | null } | null> };

const ICON = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

function TierIcon({ tier }: { tier: PaidTier }) {
  const common = { ...ICON, width: 26, height: 26 };
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

/** Ikony dlaždic „co Plus přidá“. */
function HighlightIcon({ kind }: { kind: 'upload' | 'badge' | 'auto' | 'clip' }) {
  if (kind === 'upload') {
    return (
      <svg {...ICON}>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    );
  }
  if (kind === 'badge') {
    return (
      <svg {...ICON}>
        <path d="M12 3l2.4 1.8 3-.2.9 2.9 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.9-3-.2L12 21l-2.4-1.8-3 .2-.9-2.9-2.4-1.8 1-2.8-1-2.8 2.4-1.8.9-2.9 3 .2z" />
        <path d="M9 12.2l2 2 4-4.2" />
      </svg>
    );
  }
  if (kind === 'auto') {
    return (
      <svg {...ICON}>
        <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-1 7.9" />
        <path d="M12 13v8M9 16l3-3 3 3" />
      </svg>
    );
  }
  return (
    <svg {...ICON}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9.5 2.5h5" />
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
  const [error, setError] = useState<{ text: string; detail: string | null } | null>(null);
  // Ceny ze Stripe (eura / dolary); do načtení náhradní eurová část popisku z Vercelu.
  const [live, setLive] = useState<LivePrices | null>(null);
  const [liveDone, setLiveDone] = useState(!PAYMENTS_ENABLED);
  // Poděkování po zaplacení - jakmile webhook předplatné zapíše (jednou za návrat ze Stripe).
  const [thanksOpen, setThanksOpen] = useState(false);
  const thanksShown = useRef(false);
  const envLabels = PAYMENTS_ENABLED ? allPriceLabels() : { kine: null, clips: null, all: null };

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

  useEffect(() => {
    if (!PAYMENTS_ENABLED) return;
    let alive = true;
    fetch('/api/plus/prices')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d) => {
        if (!alive) return;
        if (d?.enabled && d.ok && d.tiers) setLive(d as LivePrices);
        setLiveDone(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Dá se varianta koupit a za kolik (jen € / $). */
  const offer = (tier: PaidTier): { available: boolean; price: string | null } => {
    if (!PAYMENTS_ENABLED) return { available: false, price: null };
    if (live) {
      const a = live.tiers[tier];
      if (!a) return { available: false, price: null };
      const cur: ShownCurrency | null = a[live.currency] ? live.currency : a.eur ? 'eur' : a.usd ? 'usd' : null;
      return { available: true, price: cur ? formatPlusAmount(a[cur] as number, cur, lang) : null };
    }
    const label = envLabels[tier];
    return { available: !!label, price: shownPriceFromLabel(label, lang) };
  };

  async function call(path: string, tier?: PaidTier) {
    setBusy(tier ?? 'portal');
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' },
        // Jazyk webu - texty na platební stránce Stripe (souhlas, obnovování) v tom samém jazyce.
        body: tier ? JSON.stringify({ tier, lang }) : undefined,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) {
        // Hláška v jazyce webu podle kódu; technická zpráva serveru (anglicky ze Stripe) jen v podrobnostech.
        const byCode: Record<string, string> = {
          'already-subscribed': t('plusErrAlreadySubscribed'),
          'not-configured': t('plusNotAvailable'),
          'test-mode': t('payErrTesting'),
          'stale-customer': t('plusErrStaleCustomer'),
          'no-customer': t('plusErrNoCustomer'),
        };
        const text = (body?.code && byCode[body.code]) || (body?.comingSoon ? t('comingSoonPayments') : t('plusFailed'));
        const detail = typeof body?.error === 'string' && body.error !== text ? body.error : null;
        if (detail) console.warn('Kine Plus:', detail);
        setError({ text, detail });
        setBusy(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError({ text: t('plusFailed'), detail: null });
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

  // Po návratu ze Stripe (?ok=1) a zapsaném předplatném: okno s poděkováním a s tím, co teď člověk má.
  useEffect(() => {
    if (!justPaid || !active || thanksShown.current) return;
    thanksShown.current = true;
    setThanksOpen(true);
    try {
      // Obnovení stránky ani sdílený odkaz poděkování znovu neukáže.
      const url = new URL(window.location.href);
      url.searchParams.delete('ok');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      // jen kosmetika adresy
    }
  }, [justPaid, active]);
  useEffect(() => {
    if (!thanksOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThanksOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [thanksOpen]);
  const boughtTier: PaidTier = plan === 'kine' || plan === 'clips' ? plan : 'all';
  const boughtPerks = tiers.find((x) => x.tier === boughtTier)?.perks ?? [];

  // Tlačítko podle stavu: nepřihlášený -> přihlásit, moje -> ✓, jinak koupit (nebo nic, když varianta není).
  const cta = (tier: PaidTier) => {
    if (owns(tier)) return <span className="plus-mine">✓ {t('plusCurrent')}</span>;
    const { available, price } = offer(tier);
    if (!available) return null;
    if (me && !me.loggedIn) {
      return (
        <Link href="/login?next=/plus" className="reaction-btn plus-cta">
          {t('plusSignInToGet')}
        </Link>
      );
    }
    if (active) return null;
    // „Pořídit · €2.49 / měsíc“; bez známé částky jen „Pořídit“ (formát klíče je všude „X · {price}“).
    const label = price ? t('plusChoose').replace('{price}', `${price} ${t('plusMonthly')}`) : t('plusChoose').split(' · ')[0];
    return (
      <button type="button" className="plus-cta" onClick={() => call('/api/plus/checkout', tier)} disabled={busy !== null}>
        {busy === tier ? t('loading') : label}
      </button>
    );
  };

  // Co Plus přidá - čtyři dlaždice s velkým číslem; u každé, ke které variantě patří.
  const highlights: { kind: 'upload' | 'badge' | 'auto' | 'clip'; value: string; label: string; sub: string; tier: string }[] = [
    { kind: 'upload', value: '3×', label: t('plusHlUpload'), sub: t('plusHlUploadSub'), tier: t('plusTierKine') },
    { kind: 'badge', value: 'PLUS', label: t('plusHlBadge'), sub: t('plusHlBadgeSub'), tier: t('plusTierKine') },
    { kind: 'auto', value: t('plusHlAutoValue'), label: t('plusHlAuto'), sub: t('plusHlAutoSub'), tier: t('plusTierClips') },
    { kind: 'clip', value: '5 min', label: t('plusHlClip'), sub: t('plusHlClipSub'), tier: t('plusTierClips') },
  ];
  const alwaysFree = [t('plusHlFree1'), t('plusHlFree2'), t('plusHlFree3'), t('plusHlFree4')];

  // Podrobné srovnání po skupinách (pod rozbalením) - jen věci, které Kine opravdu dělá.
  const priceCell = (tier: PaidTier) => offer(tier).price ?? '–';
  const groups: { title: string; rows: { label: string; cells: (boolean | string)[] }[] }[] = [
    {
      title: t('plusCmpGroupWatch'),
      rows: [
        { label: t('plusCmpWatch'), cells: [true, true, true, true] },
        { label: t('plusCmpLive'), cells: [true, true, true, true] },
      ],
    },
    {
      title: t('plusCmpGroupUpload'),
      rows: [
        { label: t('plusCmpLimit'), cells: ['1×', '3×', '1×', '3×'] },
        { label: t('plusCmpStorage'), cells: ['1×', '3×', '1×', '3×'] },
      ],
    },
    {
      title: t('plusCmpGroupClips'),
      rows: [
        { label: t('plusCmpClipping'), cells: [true, true, true, true] },
        { label: t('plusCmpClipLength'), cells: ['60 s', '60 s', '5 min', '5 min'] },
        { label: t('plusCmpManualUpload'), cells: [true, true, true, true] },
        { label: t('plusCmpAutoUpload'), cells: [false, false, true, true] },
      ],
    },
    {
      title: t('plusCmpGroupProfile'),
      rows: [
        { label: t('plusCmpBadge'), cells: [false, true, false, true] },
        { label: t('plusCmpSupport'), cells: [false, true, true, true] },
      ],
    },
  ];
  const faq = [1, 2, 3, 4].map((n) => ({ q: t(`plusFaq${n}Q` as 'plusFaq1Q'), a: t(`plusFaq${n}A` as 'plusFaq1A') }));

  return (
    <div className="form-container plus-page" style={{ maxWidth: 980 }}>
      <header className="plus-hero">
        <span className="plus-eyebrow">PLUS</span>
        <h1>{t('plusHeroTitle')}</h1>
        <p>{t('plusHeroText')}</p>
      </header>
      {!PAYMENTS_ENABLED && (
        <div style={{ marginBottom: 14 }}>
          <ComingSoon text={t('comingSoonPlus')} />
        </div>
      )}

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
            {PAYMENTS_ENABLED && (
              <button type="button" onClick={() => call('/api/plus/portal')} disabled={busy !== null}>
                {t('plusManage')}
              </button>
            )}
            <Link href="/download" className="reaction-btn" style={{ display: 'inline-flex', textDecoration: 'none' }}>
              {t('desktopAppLink')}
            </Link>
          </div>
        </div>
      )}
      {me?.loggedIn && !active && justPaid && <p className="panel" style={{ margin: '0 0 14px', color: 'var(--text-dim)' }}>{t('plusWaitingPayment')}</p>}

      {thanksOpen && (
        <div className="plus-thanks-backdrop" onClick={() => setThanksOpen(false)}>
          <div className="panel plus-thanks" role="dialog" aria-modal="true" aria-labelledby="plus-thanks-title" onClick={(e) => e.stopPropagation()}>
            <div className="plus-thanks-burst" aria-hidden="true">
              {Array.from({ length: 16 }, (_, i) => (
                <i key={i} style={{ ['--i' as string]: i } as React.CSSProperties} />
              ))}
            </div>
            <span className="plus-thanks-icon">
              <TierIcon tier={boughtTier} />
            </span>
            <span className="plus-eyebrow" style={{ marginBottom: 8 }}>PLUS</span>
            <h2 id="plus-thanks-title">{t('plusThanksTitle')}</h2>
            <p className="plus-thanks-text">{t('plusThanksText').replace('{plan}', planName(plan))}</p>
            <ul className="plus-perks plus-thanks-perks">
              {boughtPerks.map((p) => (
                <li key={p}>
                  <Check />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="plus-thanks-actions">
              <Link href="/" className="plus-cta plus-thanks-go" onClick={() => setThanksOpen(false)}>
                {t('plusThanksContinue')}
              </Link>
              {boughtTier !== 'kine' && (
                <Link href="/download" className="reaction-btn plus-thanks-app" onClick={() => setThanksOpen(false)}>
                  {t('desktopAppLink')}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="plus-grid">
        {tiers.map(({ tier, title, sub, perks, featured }) => {
          const { available, price } = offer(tier);
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
                ) : !liveDone ? (
                  <span className="plus-price-skeleton" aria-hidden="true" />
                ) : available ? null : (
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
              <div className="plus-card-foot">{cta(tier)}</div>
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{ marginTop: 10 }}>
          <p className="error-text" style={{ margin: 0 }}>{error.text}</p>
          {error.detail && (
            <details style={{ marginTop: 4, fontSize: 12, color: 'var(--text-faint)' }}>
              <summary style={{ cursor: 'pointer' }}>{t('errorDetailsLabel')}</summary>
              <p style={{ margin: '4px 0 0', wordBreak: 'break-word' }}>{error.detail}</p>
            </details>
          )}
        </div>
      )}

      <section className="plus-hl" aria-labelledby="plus-hl-title">
        <div className="plus-hl-head">
          <h2 id="plus-hl-title">{t('plusHlTitle')}</h2>
          <p>{t('plusHlText')}</p>
        </div>
        <div className="plus-hl-grid">
          {highlights.map((h) => (
            <div key={h.kind} className="plus-hl-tile">
              <div className="plus-hl-top">
                <span className="plus-hl-icon">
                  <HighlightIcon kind={h.kind} />
                </span>
                <span className="plus-hl-chip">{h.tier}</span>
              </div>
              <span className={`plus-hl-value${h.kind === 'badge' ? ' is-badge' : ''}`}>{h.value}</span>
              <span className="plus-hl-label">{h.label}</span>
              <span className="plus-hl-sub">{h.sub}</span>
            </div>
          ))}
        </div>
        <div className="plus-free-strip">
          <strong>{t('plusHlFree')}</strong>
          {alwaysFree.map((item) => (
            <span key={item}>
              <Check />
              {item}
            </span>
          ))}
        </div>
      </section>

      {/* Celé srovnání pro ty, kdo chtějí detaily - schované, ať stránka nepůsobí složitě. */}
      <details className="plus-compare-details">
        <summary>
          <span>{t('plusCompareAll')}</span>
        </summary>
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
            {groups.map((group) => (
              <tbody key={group.title}>
                <tr className="plus-table-group">
                  <th scope="rowgroup">{group.title}</th>
                  <td />
                  <td />
                  <td />
                  <td className="featured" />
                </tr>
                {group.rows.map((row) => (
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
            ))}
            {PAYMENTS_ENABLED && (
              <tfoot>
                <tr className="plus-table-price">
                  <th scope="row">{t('plusCmpPrice')}</th>
                  <td>
                    <span className="plus-cell-text">{t('plusFreeTitle')}</span>
                  </td>
                  <td>
                    <span className="plus-cell-text">{priceCell('kine')}</span>
                  </td>
                  <td>
                    <span className="plus-cell-text">{priceCell('clips')}</span>
                  </td>
                  <td className="featured">
                    <span className="plus-cell-text">{priceCell('all')}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </details>

      {/* Jednorázový dar místo předplatného (stránka /donate) - až když běží placení. */}
      {PAYMENTS_ENABLED && (
        <section className="panel plus-support">
          <div>
            <p className="panel-heading" style={{ margin: 0 }}>{t('plusSupportTitle')}</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{t('plusSupportText')}</p>
          </div>
          <Link href="/donate" className="reaction-btn plus-support-btn">
            {t('donateSidebarLabel')}
          </Link>
        </section>
      )}

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
      {/* Kdo prodává (zákon to chce vidět u nákupu) - jen když je ve Vercelu vyplněný provozovatel. */}
      {PAYMENTS_ENABLED && operatorLine(lang === 'cs' || lang === 'sk' ? 'cs' : 'en') && (
        <p style={{ color: 'var(--text-faint)', fontSize: 12, lineHeight: 1.6 }}>
          {operatorLine(lang === 'cs' || lang === 'sk' ? 'cs' : 'en')} <Link href="/terms">{t('termsLink')}</Link>
        </p>
      )}
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
