'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

/**
 * Admin: nastavení plateb (Stripe) - co je hotové a co chybí, plus dvě
 * tlačítka, která ve Stripe založí ceny a webhook a vypíšou řádky do Vercelu.
 * Tajné hodnoty se nikam neukládají; podpisový klíč nového webhooku se ukáže
 * jen jednou (Stripe ho pak už nevydá) - hned ho zkopíruj do Vercelu.
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
 * Doporučené ceny (říjen 2026): Kine Plus 59 Kč - ze 49 Kč by si Stripe vzal
 * 15 % (pevných 6,50 Kč), z 59 Kč 13 %, a pořád je to levnější než Discord
 * Nitro Basic a čtvrtina YouTube Premium (239 Kč). Balíček pod 100 Kč je
 * jen o 20 Kč dražší než samotné Klipy - většina vezme balíček. Eura pro
 * Slovensko a cizinu zhruba stejně. Jde přepsat před kliknutím; nová částka
 * platí pro nové předplatitele, stávající zůstanou na staré ceně.
 */
const TIERS = [
  { tier: 'kine', name: 'Kine Plus', czk: '59', eur: '2,49' },
  { tier: 'clips', name: 'Klipy Plus', czk: '79', eur: '3,29' },
  { tier: 'all', name: 'Kine Plus + Klipy', czk: '99', eur: '3,99' },
] as const;

function Mark({ ok }: { ok: boolean | null }) {
  const color = ok === true ? 'var(--brand)' : ok === false ? '#ff6b6b' : 'var(--text-faint)';
  return (
    <span aria-label={ok === true ? 'hotovo' : ok === false ? 'chybí' : 'nevíme'} style={{ color, fontWeight: 700, width: 18, display: 'inline-block', textAlign: 'center' }}>
      {ok === true ? '✓' : ok === false ? '✗' : '–'}
    </span>
  );
}

function EnvBlock({ lines, note }: { lines: string[]; note?: string }) {
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
        {copied ? 'Zkopírováno' : 'Kopírovat'}
      </button>
    </div>
  );
}

export default function AdminStripePage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(TIERS.map((x) => [x.tier, x.czk])));
  const [eurAmounts, setEurAmounts] = useState<Record<string, string>>(() => Object.fromEntries(TIERS.map((x) => [x.tier, x.eur])));
  const [withEur, setWithEur] = useState(true);
  const [priceEnv, setPriceEnv] = useState<string[]>([]);
  const [webhookEnv, setWebhookEnv] = useState<string[]>([]);
  const [webhookNote, setWebhookNote] = useState<string | null>(null);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }

  async function load() {
    setError(null);
    const res = await fetch('/api/admin/stripe', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? 'Nepodařilo se načíst.');
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
  }, []);

  async function act(action: 'create-prices' | 'create-webhook') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/admin/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(action === 'create-prices' ? { action, currency: 'czk', amounts, eur: withEur ? eurAmounts : null } : { action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Nepodařilo se.');
      if (action === 'create-prices') setPriceEnv(body.env ?? []);
      else {
        setWebhookEnv(body.env ?? []);
        setWebhookNote(
          body.created
            ? 'Webhook je založený. Podpisový klíč Stripe ukáže JEN TEĎ - zkopíruj ho hned do Vercelu.'
            : body.updated
              ? 'Webhook už byl - opravil jsem ho (adresa, události, zapnutí). Podpisový klíč se tím nemění; najdeš ho ve Stripe (Developers → Webhooks → webhook → Signing secret).'
              : 'Webhook už je hotový. Podpisový klíč najdeš ve Stripe (Developers → Webhooks → webhook → Signing secret).'
        );
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>;
  if (!isAdmin) return <p style={{ color: 'var(--text-dim)' }}>Tahle stránka je jen pro administrátory.</p>;

  const mode = report?.info.mode;
  const dash = `https://dashboard.stripe.com${mode === 'test' ? '/test' : ''}`;
  const allOk = !!report && report.checks.every((c) => c.ok !== false);
  const acc = report?.info.account;
  const payoutText = (acc?.payoutCurrencies?.length ? acc.payoutCurrencies : acc?.defaultCurrency ? [acc.defaultCurrency] : []).map((c) => c.toUpperCase()).join(', ');

  return (
    <div className="form-container" style={{ maxWidth: 820 }}>
      <h1>Platby (Stripe)</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginTop: -6 }}>
        Kontrola, jestli je všechno připravené. Nejdřív se testovacím klíčem (sk_test_…) a kartou 4242 4242 4242 4242, pak to samé s ostrým klíčem. Řádky níž se vkládají do Vercel → Settings → Environment Variables, pak Redeploy.
      </p>

      {error && <p className="error-text">{error}</p>}

      {report && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="panel-heading" style={{ margin: 0 }}>
            {mode === 'live' ? 'Ostrý režim' : mode === 'test' ? 'Testovací režim' : 'Stripe není připojený'}
            {report.info.account?.name ? ` · ${report.info.account.name}` : ''}
            {payoutText ? ` · výplaty v ${payoutText}` : ''}
          </p>
          {report.checks.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Mark ok={c.ok} />
              <div>
                <div style={{ color: 'var(--text)', fontSize: 14 }}>{c.title}</div>
                {c.detail && <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{c.detail}</div>}
              </div>
            </div>
          ))}
          {allOk && <p style={{ margin: '6px 0 0', color: 'var(--brand)', fontSize: 14 }}>Všechno sedí - zkus nákup na <Link href="/plus">/plus</Link>.</p>}
          <button type="button" className="reaction-btn" style={{ alignSelf: 'flex-start' }} onClick={() => load()}>
            Zkontrolovat znovu
          </button>
        </div>
      )}

      {report && (mode === 'test' || mode === 'live') && (
        <>
          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel-heading" style={{ marginTop: 0 }}>1. Ceny předplatného (měsíční)</p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)' }}>
              Založí ve Stripe tři produkty s měsíční cenou. Stejná částka podruhé nic nezdvojí; nová částka platí pro nové předplatitele.
            </p>
            {TIERS.map(({ tier, name }) => (
              <div key={tier} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ width: 120 }}>{name}</span>
                <label style={{ fontSize: 13 }}>
                  Kč{' '}
                  <input value={amounts[tier]} onChange={(e) => setAmounts({ ...amounts, [tier]: e.target.value })} style={{ width: 64 }} inputMode="decimal" />
                </label>
                {withEur && (
                  <label style={{ fontSize: 13 }}>
                    €{' '}
                    <input value={eurAmounts[tier]} onChange={(e) => setEurAmounts({ ...eurAmounts, [tier]: e.target.value })} style={{ width: 64 }} inputMode="decimal" />
                  </label>
                )}
              </div>
            ))}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, margin: '4px 0 10px' }}>
              <input type="checkbox" checked={withEur} onChange={(e) => setWithEur(e.target.checked)} />
              I v eurech (zákazník mimo Česko zaplatí v eurech)
            </label>
            <button type="button" disabled={busy !== null} onClick={() => act('create-prices')}>
              {busy === 'create-prices' ? 'Zakládám…' : 'Vytvořit ceny ve Stripe'}
            </button>
            <EnvBlock lines={priceEnv} note="Tyhle řádky dej do Vercelu (každý zvlášť: název = hodnota):" />
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel-heading" style={{ marginTop: 0 }}>2. Webhook (Stripe dá Kine vědět, že někdo zaplatil)</p>
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)' }}>
              Adresa <code>{report.info.webhookUrl}</code>, události pro Kine Plus, dary, předplatné kanálů a podpory.
            </p>
            <button type="button" disabled={busy !== null} onClick={() => act('create-webhook')}>
              {busy === 'create-webhook' ? 'Zakládám…' : 'Vytvořit / opravit webhook'}
            </button>
            <EnvBlock lines={webhookEnv} note={webhookNote ?? undefined} />
            {webhookEnv.length === 0 && webhookNote && <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-dim)' }}>{webhookNote}</p>}
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <p className="panel-heading" style={{ marginTop: 0 }}>3. Zbytek ve Stripe a ve Vercelu</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--text-dim)' }}>
              <li>
                Zákaznický portál (zrušení předplatného): <a href={`${dash}/settings/billing/portal`} target="_blank" rel="noreferrer">Settings → Billing → Customer portal</a> → Save.
              </li>
              <li>
                Veřejné údaje: <a href={`${dash}/settings/public`} target="_blank" rel="noreferrer">Settings → Public details</a> - web {report.info.siteUrl}, podpora kinesupport@gmail.com, podmínky {report.info.siteUrl}/terms, ochrana údajů {report.info.siteUrl}/privacy, text na výpisu „KINE“.
              </li>
              <li>Vercel: NEXT_PUBLIC_OPERATOR_NAME (jméno), NEXT_PUBLIC_OPERATOR_ICO, NEXT_PUBLIC_OPERATOR_ADDRESS (místo podnikání) - ukážou se v podmínkách a u předplatného.</li>
              <li>Vercel: plán Pro (placení je komerční použití), pak NEXT_PUBLIC_PAYMENTS=1 a Redeploy.</li>
              <li>Peníze pro tvůrce (předplatné kanálu, podpory ve vysílání) až později: Stripe Connect + NEXT_PUBLIC_CREATOR_PAYMENTS=1.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
