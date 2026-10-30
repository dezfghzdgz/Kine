'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

/**
 * Admin: nastavení plateb (Stripe) - co je hotové a co chybí, plus dvě
 * tlačítka, která ve Stripe založí ceny a webhook a vypíšou řádky do Vercelu.
 * Tajné hodnoty se nikam neukládají; podpisový klíč nového webhooku se ukáže
 * jen jednou (Stripe ho pak už nevydá) - hned ho zkopíruj do Vercelu.
 * Česky pro cs/sk, jinak anglicky (texty kontrol posílá API ve stejném jazyce).
 * API: app/api/admin/stripe, pravidla: lib/stripeSetup.ts.
 */
type Check = { id: string; ok: boolean | null; title: string; detail?: string };
type Report = {
  checks: Check[];
  info: {
    siteUrl: string;
    webhookUrl: string;
    mode: 'missing' | 'test' | 'live' | 'invalid';
    account: { id: string; country: string | null; defaultCurrency: string | null; name: string | null; url: string | null; supportEmail: string | null; statementDescriptor: string | null; payoutCurrencies?: string[] } | null;
    webhooks: { id: string; url: string; status: string; ours: boolean; missing: string[] }[];
  };
};

/**
 * Doporučené ceny (říjen 2026), v eurech - Kine je mezinárodní a výplaty jdou
 * v eurech (žádný převod měny). Kine Plus €2.49 (méně než Discord Nitro Basic,
 * zlomek YouTube Premium), balíček €3.99 je jen o €1 dražší než samotné Klipy
 * - většina vezme balíček. Dolary pro zákazníky v USA (Stripe jim je ukáže sám).
 * Jde přepsat před kliknutím; nová částka platí pro nové předplatitele,
 * stávající zůstanou na staré ceně.
 */
const TIERS = [
  { tier: 'kine', cs: 'Kine Plus', en: 'Kine Plus', eur: '2.49', usd: '2.99' },
  { tier: 'clips', cs: 'Klipy Plus', en: 'Clips Plus', eur: '2.99', usd: '3.49' },
  { tier: 'all', cs: 'Kine Plus + Klipy', en: 'Kine Plus + Clips', eur: '3.99', usd: '4.49' },
] as const;

function Mark({ ok, labels }: { ok: boolean | null; labels: [string, string, string] }) {
  const color = ok === true ? 'var(--brand)' : ok === false ? '#ff6b6b' : 'var(--text-faint)';
  return (
    <span aria-label={ok === true ? labels[0] : ok === false ? labels[1] : labels[2]} style={{ color, fontWeight: 700, width: 18, display: 'inline-block', textAlign: 'center' }}>
      {ok === true ? '✓' : ok === false ? '✗' : '–'}
    </span>
  );
}

function EnvBlock({ lines, note, copyLabel, copiedLabel }: { lines: string[]; note?: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  if (lines.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {note && <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-dim)' }}>{note}</p>}
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--panel-raised)', padding: 10, borderRadius: 10, fontSize: 12, margin: 0 }}>{lines.join('\n')}</pre>
      <button
        type="button"
        style={{ marginTop: 6 }}
        onClick={() => {
          navigator.clipboard?.writeText(lines.join('\n')).then(() => setCopied(true), () => setCopied(false));
        }}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}

export default function AdminStripePage() {
  const { lang } = useLanguage();
  const cs = lang === 'cs' || lang === 'sk';
  const apiLang = cs ? 'cs' : 'en';
  const tx = (czech: string, english: string) => (cs ? czech : english);

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(TIERS.map((x) => [x.tier, x.eur])));
  const [usdAmounts, setUsdAmounts] = useState<Record<string, string>>(() => Object.fromEntries(TIERS.map((x) => [x.tier, x.usd])));
  const [withUsd, setWithUsd] = useState(true);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [webhookEnv, setWebhookEnv] = useState<string[]>([]);
  const [webhookNote, setWebhookNote] = useState<string | null>(null);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }

  async function load() {
    setError(null);
    const res = await fetch(`/api/admin/stripe?lang=${apiLang}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? tx('Nepodařilo se načíst.', 'Could not load.'));
    else setReport(body);
  }

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return setChecking(false);
      const { data: accountRows } = await supabase.rpc('my_account');
      const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;
      if (!account?.is_admin) return setChecking(false);
      setIsAdmin(true);
      await load();
      setChecking(false);
    })();
    // Jazyk se může přepnout - texty kontrol načíst znovu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiLang]);

  async function act(action: 'create-prices' | 'create-webhook') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/admin/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(
          action === 'create-prices'
            ? { action, lang: apiLang, currency: 'eur', amounts, extra: withUsd ? { currency: 'usd', amounts: usdAmounts } : null }
            : { action, lang: apiLang }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? tx('Nepodařilo se.', 'Failed.'));
      if (action === 'create-prices') {
        setPriceNote(
          [
            tx(
              'Hotovo - ceny jsou ve Stripe. Web je začne ukazovat a prodávat sám (do pár minut); do Vercelu nic kopírovat nemusíš.',
              'Done - the prices are at Stripe. The site starts showing and selling them by itself (within a few minutes); nothing to copy to Vercel.'
            ),
            body.renamed > 0
              ? tx(
                  `Produkty u Stripe mají teď anglické názvy a popisy (${body.renamed}×) - zákazníci je vidí na platební stránce.`,
                  `The Stripe products now have English names and descriptions (${body.renamed}×) - customers see them on the payment page.`
                )
              : '',
          ]
            .filter(Boolean)
            .join(' ')
        );
      } else {
        setWebhookEnv(body.env ?? []);
        setWebhookNote(
          body.created
            ? tx('Webhook je založený. Podpisový klíč Stripe ukáže JEN TEĎ - zkopíruj ho hned do Vercelu.', 'The webhook is created. Stripe shows the signing secret ONLY NOW - copy it to Vercel right away.')
            : body.updated
              ? tx(
                  'Webhook už byl - opravil jsem ho (adresa, události, zapnutí). Podpisový klíč se tím nemění; najdeš ho ve Stripe: Workbench → Webhooks → webhook → Reveal secret.',
                  'The webhook already existed - it is fixed now (address, events, enabled). The signing secret stays the same; find it at Stripe: Workbench → Webhooks → webhook → Reveal secret.'
                )
              : tx(
                  'Webhook už je hotový. Podpisový klíč najdeš ve Stripe: Workbench → Webhooks → webhook → Reveal secret.',
                  'The webhook is ready. Find the signing secret at Stripe: Workbench → Webhooks → webhook → Reveal secret.'
                )
        );
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>{tx('Načítám…', 'Loading…')}</p>;
  if (!isAdmin) return <p style={{ color: 'var(--text-dim)' }}>{tx('Tahle stránka je jen pro administrátory.', 'This page is for administrators only.')}</p>;

  const mode = report?.info.mode;
  const dash = `https://dashboard.stripe.com${mode === 'test' ? '/test' : ''}`;
  const allOk = !!report && report.checks.every((c) => c.ok !== false);
  const acc = report?.info.account;
  const payoutText = (acc?.payoutCurrencies?.length ? acc.payoutCurrencies : acc?.defaultCurrency ? [acc.defaultCurrency] : []).map((c) => c.toUpperCase()).join(', ');
  const markLabels: [string, string, string] = [tx('hotovo', 'done'), tx('chybí', 'missing'), tx('nevíme', 'unknown')];
  const copy = { copyLabel: tx('Kopírovat', 'Copy'), copiedLabel: tx('Zkopírováno', 'Copied') };

  return (
    <div className="form-container" style={{ maxWidth: 820 }}>
      <h1>{tx('Platby (Stripe)', 'Payments (Stripe)')}</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginTop: -6 }}>
        {tx(
          'Kontrola, jestli je všechno připravené. Řádky níž se vkládají do Vercel → Settings → Environment Variables, pak Redeploy.',
          'Checks whether everything is ready. The lines below go to Vercel → Settings → Environment Variables, then Redeploy.'
        )}
      </p>

      {error && <p className="error-text">{error}</p>}

      {report && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="panel-heading" style={{ margin: 0 }}>
            {mode === 'live' ? tx('Ostrý režim', 'Live mode') : mode === 'test' ? tx('Testovací režim', 'Test mode') : tx('Stripe není připojený', 'Stripe is not connected')}
            {report.info.account?.name ? ` · ${report.info.account.name}` : ''}
            {payoutText ? ` · ${tx('výplaty v', 'payouts in')} ${payoutText}` : ''}
          </p>
          {report.checks.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Mark ok={c.ok} labels={markLabels} />
              <div>
                <div style={{ color: 'var(--text)', fontSize: 14 }}>{c.title}</div>
                {c.detail && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{c.detail}</div>}
              </div>
            </div>
          ))}
          {allOk && (
            <p style={{ margin: '6px 0 0', color: 'var(--brand)', fontSize: 14 }}>
              {tx('Všechno sedí - zkus nákup na', 'All set - try a purchase on')} <Link href="/plus">/plus</Link>.
            </p>
          )}
          <button type="button" className="reaction-btn" style={{ alignSelf: 'flex-start' }} onClick={() => load()}>
            {tx('Zkontrolovat znovu', 'Check again')}
          </button>
        </div>
      )}

      {report && (mode === 'test' || mode === 'live') && (
        <>
          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel-heading" style={{ marginTop: 0 }}>{tx('1. Ceny předplatného (měsíční)', '1. Subscription prices (monthly)')}</p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)' }}>
              {tx(
                'Založí ve Stripe tři produkty s měsíční cenou v eurech (a dolary pro USA). Web je pak používá sám - nic se nekopíruje do Vercelu. Stejná částka podruhé nic nezdvojí; nová částka platí pro nové předplatitele.',
                'Creates three products with a monthly price in euros (and dollars for the USA) at Stripe. The site then uses them by itself - nothing is copied to Vercel. The same amount again duplicates nothing; a new amount applies to new subscribers.'
              )}
            </p>
            {TIERS.map((x) => (
              <div key={x.tier} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ width: 120 }}>{tx(x.cs, x.en)}</span>
                <label style={{ fontSize: 13 }}>
                  €{' '}
                  <input value={amounts[x.tier]} onChange={(e) => setAmounts({ ...amounts, [x.tier]: e.target.value })} style={{ width: 64 }} inputMode="decimal" />
                </label>
                {withUsd && (
                  <label style={{ fontSize: 13 }}>
                    ${' '}
                    <input value={usdAmounts[x.tier]} onChange={(e) => setUsdAmounts({ ...usdAmounts, [x.tier]: e.target.value })} style={{ width: 64 }} inputMode="decimal" />
                  </label>
                )}
              </div>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '4px 0 10px' }}>
              <input type="checkbox" checked={withUsd} onChange={(e) => setWithUsd(e.target.checked)} />
              {tx('I v dolarech (zákazník v USA zaplatí v dolarech)', 'Also in US dollars (customers in the USA pay in dollars)')}
            </label>
            <button type="button" disabled={busy !== null} onClick={() => act('create-prices')}>
              {busy === 'create-prices' ? tx('Zakládám…', 'Creating…') : tx('Vytvořit ceny ve Stripe', 'Create prices at Stripe')}
            </button>
            {priceNote && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--brand)' }}>{priceNote}</p>}
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel-heading" style={{ marginTop: 0 }}>{tx('2. Webhook (Stripe dá Kine vědět, že někdo zaplatil)', '2. Webhook (Stripe tells Kine that someone paid)')}</p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)' }}>
              {tx('Adresa', 'Address')} <code>{report.info.webhookUrl}</code>
              {tx(', události pro Kine Plus, dary, předplatné kanálů a podpory.', ', events for Kine Plus, donations, channel subscriptions and tips.')}
            </p>
            <button type="button" disabled={busy !== null} onClick={() => act('create-webhook')}>
              {busy === 'create-webhook' ? tx('Zakládám…', 'Creating…') : tx('Vytvořit / opravit webhook', 'Create / fix webhook')}
            </button>
            <EnvBlock lines={webhookEnv} note={webhookNote ?? undefined} {...copy} />
            {webhookEnv.length === 0 && webhookNote && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{webhookNote}</p>}
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel-heading" style={{ marginTop: 0 }}>{tx('3. Zbytek ve Stripe a ve Vercelu', '3. The rest at Stripe and in Vercel')}</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)' }}>
              <li>
                {tx('Zákaznický portál (zrušení předplatného):', 'Customer portal (cancelling the subscription):')}{' '}
                <a href={`${dash}/settings/billing/portal`} target="_blank" rel="noreferrer">
                  Settings → Billing → Customer portal
                </a>{' '}
                → Save.
              </li>
              <li>
                {tx('Veřejné údaje:', 'Public details:')}{' '}
                <a href={`${dash}/settings/public`} target="_blank" rel="noreferrer">
                  Settings → Business → Public details
                </a>{' '}
                - {tx('web', 'website')} {report.info.siteUrl}, {tx('podpora', 'support')} kinesupport@gmail.com, {tx('podmínky', 'terms')} {report.info.siteUrl}/terms,{' '}
                {tx('ochrana údajů', 'privacy')} {report.info.siteUrl}/privacy, {tx('text na výpisu „KINE“.', 'statement descriptor “KINE”.')}
              </li>
              <li>
                {tx(
                  'Vercel: NEXT_PUBLIC_OPERATOR_NAME (jméno), NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS (místo podnikání) - ukážou se v podmínkách a u předplatného.',
                  'Vercel: NEXT_PUBLIC_OPERATOR_NAME (name), NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS (registered address) - shown in the terms and next to the subscription.'
                )}
              </li>
              <li>{tx('Vercel: plán Pro (placení je komerční použití), pak NEXT_PUBLIC_PAYMENTS=1 a Redeploy.', 'Vercel: Pro plan (payments are commercial use), then NEXT_PUBLIC_PAYMENTS=1 and Redeploy.')}</li>
              <li>
                {tx(
                  'Peníze pro tvůrce (předplatné kanálu, podpory ve vysílání, Super díky pod videi): Stripe Connect, migrace a NEXT_PUBLIC_CREATOR_PAYMENTS=1 - postup v NASAZENI-NAVOD.md, krok 8.',
                  'Creator payments (channel subscriptions, tips in streams, Super Thanks under videos): Stripe Connect, migrations and NEXT_PUBLIC_CREATOR_PAYMENTS=1 - steps in NASAZENI-NAVOD.md, step 8.'
                )}
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
