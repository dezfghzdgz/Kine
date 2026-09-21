'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Admin: kdo má Kine Plus a ruční přidělení / odebrání.
 *
 * Bez hledání ukazuje všechny s Plus. Ruční Plus přebíjí Stripe (vazba
 * na předplatné se zahodí) - hodí se pro partnery, testery a náhrady.
 */
type Row = {
  id: string;
  username: string;
  display_name: string | null;
  plan: string;
  plan_until: string | null;
  plan_note: string | null;
  active: boolean;
  viaStripe: boolean;
};

export default function AdminPlusPage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { until: string; note: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setChecking(false);
        return;
      }
      const { data: accountRows } = await supabase.rpc('my_account');
      const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;
      if (!account?.is_admin) {
        setChecking(false);
        return;
      }
      setIsAdmin(true);
      await load('');
      setChecking(false);
    })();
  }, []);

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }

  async function load(term: string) {
    setError(null);
    const res = await fetch(`/api/admin/plus?search=${encodeURIComponent(term)}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.code === 'not-configured') setNotConfigured(true);
      else setError(body.error ?? 'Nepodařilo se načíst.');
      return;
    }
    setUsers(body.users ?? []);
  }

  async function setPlan(user: Row, plan: 'free' | 'plus') {
    setSavingId(user.id);
    setError(null);
    const draft = drafts[user.id] ?? { until: '', note: '' };
    const res = await fetch('/api/admin/plus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ userId: user.id, plan, until: draft.until || null, note: draft.note || null }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) setError(body.error ?? 'Uložení se nepovedlo.');
    await load(search);
    setSavingId(null);
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>;
  if (!isAdmin) return <p style={{ color: 'var(--text-dim)' }}>Tahle stránka je jen pro administrátory.</p>;

  return (
    <div className="form-container" style={{ maxWidth: 820 }}>
      <h1>Kine Plus</h1>
      <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.6, marginTop: -6 }}>
        Kdo má placenou verzi. Bez hledání jsou tu všichni s Plus. Ruční Plus přebíjí předplatné u Stripe.
      </p>

      {notConfigured && (
        <div className="panel">
          <p style={{ margin: 0, color: 'var(--text)' }}>Chybí migrace <code>supabase-migration-kine-plus.sql</code> - pusť ji v Supabase SQL editoru.</p>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(search);
        }}
        style={{ display: 'flex', gap: 10, marginBottom: 14 }}
      >
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hledat podle jména…" style={{ flex: 1 }} />
        <button type="submit">Hledat</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.length === 0 && !notConfigured && <p style={{ color: 'var(--text-faint)' }}>Nikdo.</p>}
        {users.map((u) => {
          const draft = drafts[u.id] ?? { until: u.plan_until ? u.plan_until.slice(0, 10) : '', note: u.plan_note ?? '' };
          return (
            <div key={u.id} className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <strong>@{u.username}</strong>
                  {u.display_name && <span style={{ color: 'var(--text-dim)' }}> · {u.display_name}</span>}
                </div>
                <span style={{ fontSize: 13, color: u.active ? 'var(--brand)' : 'var(--text-faint)' }}>
                  {u.active ? `PLUS${u.plan_until ? ` do ${new Date(u.plan_until).toLocaleDateString('cs-CZ')}` : ' bez konce'}${u.viaStripe ? ' · Stripe' : ' · ručně'}` : 'základní'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                  Platí do (prázdné = bez konce)
                  <input
                    type="date"
                    value={draft.until}
                    onChange={(e) => setDrafts({ ...drafts, [u.id]: { ...draft, until: e.target.value } })}
                    style={{ display: 'block', marginTop: 4 }}
                  />
                </label>
                <label style={{ fontSize: 12, color: 'var(--text-faint)', flex: 1, minWidth: 180 }}>
                  Poznámka
                  <input
                    value={draft.note}
                    onChange={(e) => setDrafts({ ...drafts, [u.id]: { ...draft, note: e.target.value } })}
                    style={{ display: 'block', marginTop: 4, width: '100%' }}
                  />
                </label>
                <button type="button" disabled={savingId === u.id} onClick={() => setPlan(u, 'plus')}>
                  Dát Plus
                </button>
                <button type="button" className="reaction-btn" disabled={savingId === u.id || u.plan !== 'plus'} onClick={() => setPlan(u, 'free')}>
                  Odebrat
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
