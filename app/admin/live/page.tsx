'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/lib/authHeaders';
import { useUserRole } from '@/lib/useUserRole';

/**
 * Diagnostika živého vysílání (jen pro tým Kine): co si server o každém
 * přenosu myslí a proč - databáze, Cloudflare, kdo přenos vidí, deník
 * událostí s důvody (app/api/admin/live). Když "appka hlásí, že vysílám,
 * ale na webu nejsem", tady je vidět kde to vázne. "Kopírovat" dá celý
 * přehled do schránky (k poslání).
 */

type Channel = {
  ownerId: string;
  username: string | null;
  displayName: string | null;
  isLive: boolean;
  title: string;
  visibility: 'public' | 'offline' | 'moderation' | 'shadow-ban' | 'banned' | 'no-profile';
  startedAgoS: number | null;
  endedAgoS: number | null;
  updatedAgoS: number | null;
  appPingAgoS: number | null;
  appPingFresh: boolean;
  appTrusted: boolean;
  cfConfirmedAgoS: number | null;
  videoUid: string | null;
  inputId: string;
  cloudflare: { listed: boolean; listedVideo: string | null; receiving: boolean | null; lifecycleVideo: string | null };
  decision: 'confirm' | 'keep' | 'end' | 'none';
  moderation: { hiddenAgoS: number | null; hiddenNow: boolean; strikes: number };
};

type Data = {
  now: string;
  cloudflare: { configured: boolean; ok: boolean; error: string | null; listed: number; customerCode: string | null };
  columns: { app_ping_at: boolean | null; cf_confirmed_at: boolean | null; moderation_hidden_at: boolean | null };
  channels: Channel[];
  events: { at: string; ownerId: string | null; username: string | null; message: string; details: string | null }[];
};

function ago(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 0) return 'za chvíli';
  if (seconds < 90) return `před ${seconds} s`;
  if (seconds < 5400) return `před ${Math.round(seconds / 60)} min`;
  return `před ${Math.round(seconds / 3600)} h`;
}

const VISIBILITY: Record<Channel['visibility'], { text: string; ok: boolean }> = {
  public: { text: 'vidí ho všichni', ok: true },
  offline: { text: 'nevysílá', ok: true },
  moderation: { text: 'ostatní ho NEVIDÍ - skrytý automatickou kontrolou obsahu (pustíš v Nahlášeních)', ok: false },
  'shadow-ban': { text: 'ostatní ho NEVIDÍ - kanál má shadow-ban (zrušíš u kanálu)', ok: false },
  banned: { text: 'ostatní ho NEVIDÍ - účet je zablokovaný', ok: false },
  'no-profile': { text: 'ostatní ho NEVIDÍ - k přenosu chybí profil', ok: false },
};

const DECISION: Record<Channel['decision'], string> = {
  confirm: 'potvrdit - je živě',
  keep: 'nechat živě (Cloudflare to teď nepotvrdil, věří se appce / krátkému výpadku)',
  end: 'UKONČIT - Cloudflare přenos nevidí a appce se už nevěří',
  none: 'nic - nevysílá',
};

function receivingText(v: boolean | null): string {
  return v === true ? 'přijímá vysílání' : v === false ? 'NEPŘIJÍMÁ vysílání' : 'nejde zjistit';
}

function channelText(c: Channel): string {
  return [
    `@${c.username ?? c.ownerId} - ${c.isLive ? 'ŽIVĚ' : 'nevysílá'} - ${VISIBILITY[c.visibility].text}`,
    `  Cloudflare: ${receivingText(c.cloudflare.receiving)}, v seznamu běžících: ${c.cloudflare.listed ? 'ano' : 'ne'}`,
    `  appka hlásila: ${ago(c.appPingAgoS)}${c.appPingAgoS !== null ? (c.appTrusted ? ' (věří se jí)' : ' (už se jí nevěří)') : ''}, Cloudflare potvrdil: ${ago(c.cfConfirmedAgoS)}`,
    `  začátek: ${ago(c.startedAgoS)}, konec: ${ago(c.endedAgoS)}, video: ${c.videoUid ?? '—'}, vstup: ${c.inputId}`,
    `  rozhodnutí teď: ${DECISION[c.decision]}`,
    c.moderation.hiddenAgoS !== null ? `  kontrola obsahu: skryto ${ago(c.moderation.hiddenAgoS)} (${c.moderation.hiddenNow ? 'platí' : 'už neplatí'}), podezřelé snímky: ${c.moderation.strikes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export default function AdminLivePage() {
  const { isModerator, isAdmin, loading: roleLoading } = useUserRole();
  const staff = isModerator || isAdmin;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (!staff) return;
    let cancelled = false;
    async function load() {
      if (document.hidden) return;
      try {
        const res = await fetch('/api/admin/live', { cache: 'no-store', headers: await authHeaders() });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) {
          setError(body?.error ?? `HTTP ${res.status}`);
          return;
        }
        setData(body);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    void load();
    const timer = setInterval(load, 10_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [staff]);

  async function copy() {
    if (!data) return;
    const text = [
      `Kine - diagnostika živého vysílání (${new Date(data.now).toLocaleString('cs-CZ')})`,
      `Cloudflare: ${data.cloudflare.configured ? (data.cloudflare.ok ? `OK, právě vysílá ${data.cloudflare.listed}` : `CHYBA: ${data.cloudflare.error}`) : 'není nastavený'}; kód zákazníka: ${data.cloudflare.customerCode ?? '—'}`,
      `Sloupce v databázi: app_ping_at ${data.columns.app_ping_at}, cf_confirmed_at ${data.columns.cf_confirmed_at}, moderation_hidden_at ${data.columns.moderation_hidden_at}`,
      '',
      ...(data.channels.length > 0 ? data.channels.map(channelText) : ['(za posledních 6 h žádný přenos)']),
      '',
      'Deník:',
      ...data.events.slice(0, 40).map((e) => `${new Date(e.at).toLocaleTimeString('cs-CZ')} @${e.username ?? e.ownerId ?? '?'} ${e.message}${e.details ? ` | ${e.details.replace(/\n/g, '; ')}` : ''}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // schránka nejde
    }
  }

  if (roleLoading) return <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>;
  if (!staff) {
    return (
      <div className="auth-gate">
        <p>Tahle stránka je jen pro tým Kine (moderátoři a správci).</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <p className="section-title" style={{ margin: 0 }}>
          Živé vysílání - diagnostika
        </p>
        <button type="button" onClick={copy} disabled={!data} style={{ marginLeft: 'auto' }}>
          {copied ? 'Zkopírováno' : 'Kopírovat přehled'}
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 0 }}>
        Co si server myslí o přenosech za posledních 6 hodin a proč. Obnovuje se každých 10 s. Když appka hlásí vysílání,
        ale na webu přenos není, tady je vidět kde to vázne - &quot;Kopírovat přehled&quot; a poslat.
      </p>

      {error && <p className="error-text">{error}</p>}
      {!data && !error && <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>}

      {data && (
        <>
          <div className="panel" style={{ marginBottom: 16, fontSize: 13, lineHeight: 1.7 }}>
            <div>
              <strong>Cloudflare:</strong>{' '}
              {!data.cloudflare.configured
                ? 'není na serveru nastavený'
                : data.cloudflare.ok
                  ? `odpovídá, právě vysílá ${data.cloudflare.listed} ${data.cloudflare.listed === 1 ? 'vstup' : 'vstupů'}`
                  : `CHYBA - ${data.cloudflare.error}`}
              {' · '}kód zákazníka: {data.cloudflare.customerCode ?? 'neznámý (lifecycle nejde zjistit)'}
            </div>
            <div style={{ color: 'var(--text-faint)' }}>
              Migrace: hlášení z appky {data.columns.app_ping_at === false ? 'CHYBÍ (supabase-migration-live-app.sql)' : 'ok'} · potvrzení od Cloudflare{' '}
              {data.columns.cf_confirmed_at === false ? 'chybí (supabase-migration-bezpecnost-rijen.sql)' : 'ok'} · kontrola obsahu{' '}
              {data.columns.moderation_hidden_at === false ? 'chybí' : 'ok'}
            </div>
          </div>

          {data.channels.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Za posledních 6 hodin žádný přenos.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {data.channels.map((c) => {
                const vis = VISIBILITY[c.visibility];
                return (
                  <div key={c.ownerId} className="panel" style={{ padding: 14, fontSize: 13, lineHeight: 1.7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span className={c.isLive ? 'live-pill' : 'live-status-off-dot'} aria-hidden={!c.isLive}>
                        {c.isLive ? '● ŽIVĚ' : ''}
                      </span>
                      <strong>
                        <Link href={`/live/${c.ownerId}`}>@{c.username ?? c.ownerId}</Link>
                      </strong>
                      {c.title && <span style={{ color: 'var(--text-dim)' }}>{c.title}</span>}
                    </div>
                    <div style={{ color: vis.ok ? 'var(--text)' : '#f59e0b', fontWeight: vis.ok ? 400 : 700 }}>Ostatní: {vis.text}</div>
                    <div>
                      Cloudflare: <strong>{receivingText(c.cloudflare.receiving)}</strong>, v seznamu běžících: {c.cloudflare.listed ? 'ano' : 'ne'}
                    </div>
                    <div>
                      Appka hlásila: {ago(c.appPingAgoS)}
                      {c.appPingAgoS !== null && (c.appTrusted ? ' (věří se jí)' : ' (už se jí nevěří)')} · Cloudflare potvrdil: {ago(c.cfConfirmedAgoS)}
                    </div>
                    <div style={{ color: 'var(--text-dim)' }}>
                      Začátek: {ago(c.startedAgoS)} · konec: {ago(c.endedAgoS)} · video: {c.videoUid ?? '—'}
                    </div>
                    <div>
                      Rozhodnutí teď: <strong>{DECISION[c.decision]}</strong>
                    </div>
                    {c.moderation.hiddenAgoS !== null && (
                      <div style={{ color: 'var(--text-dim)' }}>
                        Kontrola obsahu: skryto {ago(c.moderation.hiddenAgoS)} ({c.moderation.hiddenNow ? 'platí pro tenhle přenos' : 'už neplatí'}), podezřelé snímky: {c.moderation.strikes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="panel-heading">Deník (nejnovější nahoře)</p>
          {data.events.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Zatím nic - deník se začne plnit s dalším vysíláním.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.events.map((e, i) => (
                <div key={i} className="panel" style={{ padding: '8px 12px', fontSize: 13 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{new Date(e.at).toLocaleString('cs-CZ')}</span>
                    <strong>@{e.username ?? e.ownerId ?? '?'}</strong>
                    <span style={{ flex: 1, minWidth: 200 }}>{e.message.replace(/^Živě: /, '')}</span>
                    {e.details && (
                      <button type="button" onClick={() => setOpen(open === i ? null : i)} style={{ padding: '2px 8px', fontSize: 12 }}>
                        {open === i ? 'Skrýt' : 'Proč'}
                      </button>
                    )}
                  </div>
                  {open === i && e.details && (
                    <pre style={{ margin: '8px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--text-dim)' }}>{e.details}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
