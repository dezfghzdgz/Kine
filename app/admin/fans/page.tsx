'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ConfirmDialog from '@/components/ConfirmDialog';
import { groupByDay, type FanEntry } from '@/lib/fans';

/**
 * Admin: Zeď fanoušků (playkine.com/fans). Napíšeš přezdívku z Instagramu,
 * Enter - a jméno je hned na webu. Jde vložit i víc jmen naráz (každé na nový
 * řádek nebo oddělené čárkou). Den kampaně se počítá sám (od prvního jména,
 * podle českého kalendáře), jde ho ale přepsat. Kdo má i účet na Kine, toho
 * jde propojit - na zdi dostane odkaz na kanál a na profilu odznak Zakladatel.
 */
type Wall = { entries: FanEntry[]; total: number; instagramRaw: string | null; today: number };

export default function AdminFansPage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [wall, setWall] = useState<Wall | null>(null);
  const [notMigrated, setNotMigrated] = useState(false);
  const [names, setNames] = useState('');
  const [day, setDay] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [instagram, setInstagram] = useState('');
  const [linkDrafts, setLinkDrafts] = useState<Record<number, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<FanEntry | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setChecking(false);
        return;
      }
      const { data: accountRows } = await supabase.rpc('my_account');
      const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;
      if (!account?.is_admin && account?.role !== 'admin') {
        setChecking(false);
        return;
      }
      setIsAdmin(true);
      await load();
      setChecking(false);
    })();
  }, []);

  async function headers(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` };
  }

  async function load() {
    const res = await fetch('/api/admin/fans', { headers: await headers(), cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (res.status === 503 && body?.code === 'not-migrated') {
      setNotMigrated(true);
      return;
    }
    if (!res.ok) {
      setMessage({ text: body?.error ?? 'Nepodařilo se načíst.', error: true });
      return;
    }
    setNotMigrated(false);
    setWall({ entries: body.entries ?? [], total: body.total ?? 0, instagramRaw: body.instagramRaw ?? null, today: body.today ?? 1 });
    setInstagram((prev) => prev || (body.instagramRaw ? `@${body.instagramRaw}` : ''));
  }

  async function post(payload: Record<string, unknown>) {
    const res = await fetch('/api/admin/fans', { method: 'POST', headers: await headers(), body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }

  async function add(e?: React.FormEvent) {
    e?.preventDefault();
    if (!names.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { ok, body } = await post({ action: 'add', handles: names, day: day.trim() || undefined });
      if (!ok) {
        setMessage({ text: body?.error ?? 'Nepodařilo se přidat.', error: true });
        return;
      }
      const parts: string[] = [];
      if (body.added?.length) parts.push(`Přidáno (Den ${body.day}): ${body.added.map((h: string) => '@' + h).join(', ')}`);
      if (body.duplicates?.length) parts.push(`Už na zdi bylo: ${body.duplicates.map((h: string) => '@' + h).join(', ')}`);
      if (body.invalid?.length) parts.push(`Neplatné: ${body.invalid.join(', ')}`);
      setMessage({ text: parts.join(' · ') || 'Hotovo.', error: !body.added?.length });
      setNames('');
      await load();
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function act(payload: Record<string, unknown>, done?: () => void) {
    setMessage(null);
    const { ok, body } = await post(payload);
    if (!ok) {
      setMessage({ text: body?.error ?? 'Nepodařilo se.', error: true });
      return;
    }
    if (payload.action === 'link' && body.badge === false) {
      setMessage({ text: 'Propojeno. Odznak Zakladatel se nepřidal - spusť migraci supabase-migration-fans.sql.', error: true });
    }
    done?.();
    await load();
  }

  async function saveInstagram() {
    setMessage(null);
    const { ok, body } = await post({ action: 'settings', instagram });
    setMessage(ok ? { text: body.instagram ? `Uloženo: @${body.instagram}` : 'Tlačítko Instagramu je vypnuté.', error: false } : { text: body?.error ?? 'Nepodařilo se uložit.', error: true });
    if (ok) {
      setInstagram(body.instagram ? `@${body.instagram}` : '');
      await load();
    }
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>;
  if (!isAdmin) return <p>Tahle stránka je jen pro správce.</p>;

  const days = wall ? groupByDay(wall.entries) : [];

  return (
    <div className="fans-admin">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Zeď fanoušků</h1>
        <Link href="/fans" target="_blank" className="streams-btn">
          Otevřít zeď ↗
        </Link>
      </div>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>
        Jen přezdívka z Instagramu (žádné skutečné jméno). Kdo tam být nechce, toho smaž. Na webu:{' '}
        <Link href="/fans" target="_blank">
          playkine.com/fans
        </Link>
      </p>

      {notMigrated && (
        <div className="panel" style={{ borderColor: 'var(--danger, #ef4444)' }}>
          Nejdřív spusť v Supabase (SQL Editor) soubor <code>supabase-migration-fans.sql</code>, pak stránku obnov.
        </div>
      )}

      {wall && (
        <>
          <form className="panel fans-admin-add" onSubmit={add}>
            <label htmlFor="fans-names" className="panel-heading" style={{ display: 'block' }}>
              Přidat na zeď
            </label>
            <textarea
              id="fans-names"
              ref={inputRef}
              rows={2}
              value={names}
              onChange={(e) => setNames(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="@prezdivka (víc jmen: každé na nový řádek nebo oddělené čárkou)"
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
                Den
                <input type="number" min={1} value={day} onChange={(e) => setDay(e.target.value)} placeholder={String(wall.today)} style={{ width: 90 }} />
              </label>
              <button type="submit" className="streams-btn primary" disabled={busy || !names.trim()}>
                {busy ? 'Přidávám…' : 'Přidat (Enter)'}
              </button>
              <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>Dnes je Den {wall.today} · na zdi {wall.total}</span>
            </div>
          </form>

          {message && <p className={message.error ? 'error-text' : 'fans-admin-ok'}>{message.text}</p>}

          <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>Instagram Kine (tlačítko „Sledovat“ na zdi):</span>
            <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@ucet_kine" style={{ width: 220 }} />
            <button type="button" className="streams-btn" onClick={saveInstagram}>
              Uložit
            </button>
          </div>

          {days.map((d) => (
            <section key={d.day} className="panel" style={{ marginTop: 12 }}>
              <p className="panel-heading" style={{ marginTop: 0 }}>
                Den {d.day} · {d.entries.length}
              </p>
              <ul className="fans-admin-list">
                {d.entries.map((e) => (
                  <li key={e.id}>
                    <strong>@{e.handle}</strong>
                    <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{new Date(e.createdAt).toLocaleString('cs-CZ')}</span>
                    {e.kine ? (
                      <>
                        <Link href={`/channel/${e.kine.id}`} target="_blank">
                          Kine: {e.kine.username}
                        </Link>
                        <button type="button" className="streams-btn" onClick={() => act({ action: 'unlink', id: e.id })}>
                          Zrušit propojení
                        </button>
                      </>
                    ) : (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <input
                          value={linkDrafts[e.id] ?? ''}
                          onChange={(ev) => setLinkDrafts((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                          placeholder="jméno na Kine"
                          style={{ width: 150 }}
                        />
                        <button
                          type="button"
                          className="streams-btn"
                          disabled={!(linkDrafts[e.id] ?? '').trim()}
                          onClick={() =>
                            act({ action: 'link', id: e.id, username: linkDrafts[e.id] }, () =>
                              setLinkDrafts((prev) => {
                                const next = { ...prev };
                                delete next[e.id];
                                return next;
                              })
                            )
                          }
                        >
                          Propojit
                        </button>
                      </span>
                    )}
                    <button type="button" className="streams-btn content-check-remove" onClick={() => setConfirmRemove(e)}>
                      Smazat
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message={`Smazat @${confirmRemove.handle} ze zdi?`}
          confirmLabel="Smazat"
          danger
          onConfirm={() => {
            const id = confirmRemove.id;
            setConfirmRemove(null);
            act({ action: 'remove', id });
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
