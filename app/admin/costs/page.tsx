'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import type { CostReport } from '@/lib/costs';
import UiIcon, { type UiIconName } from '@/components/UiIcon';

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max > 0 ? Math.min(1, value / max) : 0;
  const tone = share >= 0.95 ? 'crit' : share >= 0.8 ? 'warn' : 'ok';
  return (
    <div className="cost-meter" role="img" aria-label={label}>
      <div className="cost-meter-track">
        <span className={`cost-meter-fill ${tone}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      <span className="cost-meter-label">{label}</span>
    </div>
  );
}

/**
 * Admin -> Náklady: kolik Kine stojí a co se blíží limitu (lib/costs.ts).
 * Úložiště a přehrávání videí u Cloudflare, živé přenosy, nahrávání,
 * databáze a obrázky v Supabase. Varování přijdou i jako oznámení (denně).
 */
export default function AdminCostsPage() {
  const { lang } = useLanguage();
  const cs = lang === 'cs' || lang === 'sk';
  const tx = (czech: string, english: string) => (cs ? czech : english);
  const locale = DATE_LOCALES[lang];
  const nf = (n: number) => new Intl.NumberFormat(locale).format(Math.round(n));
  const usd = (n: number | null) => (n === null ? '–' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n));
  const mb = (b: number | null) => (b === null ? '–' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${Math.round(b / 1024 ** 2)} MB`);

  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [report, setReport] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    if (!token) {
      setChecking(false);
      setLoading(false);
      return;
    }
    const res = await fetch('/api/admin/costs', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (res.status === 403) {
      setIsAdmin(false);
    } else if (res.ok) {
      setIsAdmin(true);
      setReport(await res.json());
    } else {
      setIsAdmin(true);
      setError(tx('Načtení se nepovedlo - zkus to za chvíli.', 'Could not load - try again shortly.'));
    }
    setChecking(false);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>{tx('Načítám…', 'Loading…')}</p>;
  if (!isAdmin) return <div className="auth-gate"><p>{tx('Jen pro správce.', 'Admins only.')}</p></div>;

  const r = report;
  const days = r?.delivery.days ?? [];
  const maxDay = Math.max(1, ...days.map((d) => d.minutes));
  const card = (icon: UiIconName, title: string, value: string, sub: string) => (
    <div className="cost-card">
      <span className="cost-card-icon" aria-hidden="true">
        <UiIcon name={icon} size={17} />
      </span>
      <span className="cost-card-value">{value}</span>
      <span className="cost-card-title">{title}</span>
      <span className="cost-card-sub">{sub}</span>
    </div>
  );

  return (
    <div className="admin-page" style={{ maxWidth: 960 }}>
      <div className="admin-title-row">
        <h1 className="admin-title">
          <UiIcon name="chart" size={22} /> {tx('Náklady', 'Costs')}
        </h1>
        <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>
          <UiIcon name="refresh" size={15} /> {loading ? tx('Načítám…', 'Loading…') : tx('Obnovit', 'Refresh')}
        </button>
      </div>
      <p className="admin-lead">
        {tx(
          'Co Kine stojí a co se blíží limitu. Když něco hoří, přijde ti oznámení (kontrola jednou denně).',
          'What Kine costs and what is close to a limit. You get a notification when something needs attention (checked daily).'
        )}{' '}
        <Link href="/admin/push">{tx('Push oznámení →', 'Push notifications →')}</Link>
      </p>
      {error && <p className="error-text">{error}</p>}

      {r && (
        <>
          {r.alerts.length > 0 ? (
            <div className="cost-alerts">
              {r.alerts.map((a) => (
                <p key={a.key} className={`cost-alert ${a.level}`}>
                  <UiIcon name="warning" size={16} /> {cs ? a.text : a.en ?? a.text}
                </p>
              ))}
            </div>
          ) : (
            <p className="cost-alert ok">
              <UiIcon name="check" size={16} /> {tx('Všechno v pořádku - nic se neblíží limitu.', 'All good - nothing is close to a limit.')}
            </p>
          )}

          <div className="cost-cards">
            {card(
              'film',
              tx('Uložená videa (Cloudflare)', 'Stored video (Cloudflare)'),
              r.stream.storedMinutes === null ? '–' : `${nf(r.stream.storedMinutes)} min`,
              r.stream.error ?? (r.stream.limitMinutes ? tx(`z ${nf(r.stream.limitMinutes)} min předplaceno`, `of ${nf(r.stream.limitMinutes)} min prepaid`) : '')
            )}
            {card(
              'eye',
              tx('Přehráno tento měsíc', 'Delivered this month'),
              r.delivery.monthMinutes === null ? '–' : `${nf(r.delivery.monthMinutes)} min`,
              r.delivery.error ?? tx(`dnes ${nf(r.delivery.todayMinutes ?? 0)} min`, `today ${nf(r.delivery.todayMinutes ?? 0)} min`)
            )}
            {card(
              'coins',
              tx('Odhad za měsíc', 'Monthly estimate'),
              usd(r.estimate.storageUsd !== null || r.estimate.deliveryProjectedUsd !== null ? (r.estimate.storageUsd ?? 0) + (r.estimate.deliveryProjectedUsd ?? 0) : null),
              tx(`úložiště ${usd(r.estimate.storageUsd)} + přehrávání ${usd(r.estimate.deliveryProjectedUsd)}`, `storage ${usd(r.estimate.storageUsd)} + delivery ${usd(r.estimate.deliveryProjectedUsd)}`)
            )}
            {card(
              'broadcast',
              tx('Živé přenosy (30 dní)', 'Live streams (30 days)'),
              `${nf(r.live.minutes30d)} min`,
              tx(`teď živě: ${r.live.liveNow}`, `live now: ${r.live.liveNow}`)
            )}
            {card(
              'upload',
              tx('Nahráno za 24 h', 'Uploaded in 24 h'),
              `${nf(r.uploads.minutes24h)} min`,
              tx(`${r.uploads.count24h} videí · týden ${nf(r.uploads.minutes7d)} min`, `${r.uploads.count24h} videos · week ${nf(r.uploads.minutes7d)} min`)
            )}
          </div>

          {r.stream.limitMinutes && r.stream.storedMinutes !== null && (
            <div className="panel">
              <p className="panel-heading">{tx('Úložiště videí u Cloudflare', 'Video storage at Cloudflare')}</p>
              <Meter value={r.stream.storedMinutes} max={r.stream.limitMinutes} label={`${nf(r.stream.storedMinutes)} / ${nf(r.stream.limitMinutes)} min · ${r.stream.videoCount ?? '–'} ${tx('videí', 'videos')}`} />
              <p className="admin-note">
                {tx(
                  `Předplacené po 1000 minutách ($${r.prices.storagePer1000} měsíčně). Když dojde, nejde nahrávat ani vysílat.`,
                  `Prepaid in blocks of 1,000 minutes ($${r.prices.storagePer1000}/month). When it runs out, uploads and live streams stop.`
                )}
              </p>
            </div>
          )}

          {days.length > 0 && (
            <div className="panel">
              <p className="panel-heading">{tx('Přehrané minuty po dnech', 'Delivered minutes per day')}</p>
              <div className="cost-bars" role="img" aria-label={tx('Graf přehraných minut', 'Delivered minutes chart')}>
                {days.slice(-31).map((d) => (
                  <div key={d.date} className="cost-bar" title={`${d.date}: ${nf(d.minutes)} min`}>
                    <span style={{ height: `${Math.max(2, (d.minutes / maxDay) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <p className="admin-note">{tx(`$${r.prices.deliveryPer1000} za 1000 přehraných minut.`, `$${r.prices.deliveryPer1000} per 1,000 minutes delivered.`)}</p>
            </div>
          )}

          <div className="cost-two">
            <div className="panel">
              <p className="panel-heading">{tx('Nejvíc nahrávali (7 dní)', 'Top uploaders (7 days)')}</p>
              {r.uploads.top.length === 0 ? (
                <p className="admin-note">–</p>
              ) : (
                <ol className="cost-top">
                  {r.uploads.top.map((u) => (
                    <li key={u.id}>
                      <Link href={`/channel/${u.id}`}>{u.name}</Link>
                      <span>{nf(u.minutes)} min</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="panel">
              <p className="panel-heading">{tx('Nejvíc vysílali (30 dní)', 'Top streamers (30 days)')}</p>
              {r.live.top.length === 0 ? (
                <p className="admin-note">–</p>
              ) : (
                <ol className="cost-top">
                  {r.live.top.map((u) => (
                    <li key={u.id}>
                      <Link href={`/channel/${u.id}`}>{u.name}</Link>
                      <span>{nf(u.minutes)} min</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="panel">
            <p className="panel-heading">Supabase</p>
            {!r.supabase ? (
              <p className="admin-note">{tx('Chybí migrace supabase-migration-push-hry-naklady.sql.', 'Missing migration supabase-migration-push-hry-naklady.sql.')}</p>
            ) : (
              <>
                <Meter value={r.supabase.dbBytes ?? 0} max={r.supabase.dbLimit} label={`${tx('Databáze', 'Database')}: ${mb(r.supabase.dbBytes)} / ${mb(r.supabase.dbLimit)}`} />
                <Meter value={r.supabase.storageBytes ?? 0} max={r.supabase.storageLimit} label={`${tx('Obrázky (úložiště)', 'Images (storage)')}: ${mb(r.supabase.storageBytes)} / ${mb(r.supabase.storageLimit)}`} />
                {r.supabase.tables.length > 0 && (
                  <p className="admin-note">
                    {tx('Největší tabulky: ', 'Largest tables: ')}
                    {r.supabase.tables.slice(0, 5).map((tb) => `${tb.name} ${mb(tb.bytes)}`).join(' · ')}
                  </p>
                )}
                <p className="admin-note">
                  {tx(
                    'Limity podle tarifu Free. Přenesená data (egress) a limity Vercelu najdeš v jejich přehledech.',
                    'Limits for the Free plan. Egress and Vercel limits are in their dashboards.'
                  )}
                </p>
              </>
            )}
          </div>
          <p className="admin-note">
            {tx('Načteno', 'Loaded')} {new Date(r.at).toLocaleString(locale)}
          </p>
        </>
      )}
    </div>
  );
}
