'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { ErrorGroup } from '@/lib/errorGroups';

/**
 * Chyby z prohlížečů návštěvníků, seskupené.
 *
 * Do teď se každá chyba v appce našla ručně - někdo si všiml, že něco
 * nefunguje. Tady je vidět, co komu spadlo, i na zařízeních, která nemáš
 * v ruce: text chyby, kolikrát, kdy naposled, na jakých stránkách a
 * zařízeních, a zásobník volání z posledního výskytu.
 *
 * Sto stejných chyb je jeden řádek s číslem 100, ne sto řádků - stejně
 * jako u hlášení videí. "Vyřešeno" skupinu smaže; když se chyba vrátí,
 * objeví se znovu.
 */
export default function AdminErrorsPage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [days, setDays] = useState(7);
  const [groups, setGroups] = useState<ErrorGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    checkAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAdmin) load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  async function checkAndLoad() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setChecking(false);
      return;
    }
    // is_admin se z prohlížeče nečte přímo - viz /admin/revenue-share.
    const { data: accountRows } = await supabase.rpc('my_account');
    const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;
    if (!account?.is_admin) {
      setChecking(false);
      return;
    }
    setIsAdmin(true);
    await load(days);
    setChecking(false);
  }

  async function authHeader() {
    const { data: sessionData } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${sessionData.session?.access_token}` };
  }

  async function load(d: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/client-errors?days=${d}`, { headers: await authHeader() });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Načtení se nepovedlo.');
        return;
      }
      setGroups(data.groups ?? []);
      setTotal(data.total ?? 0);
      setTruncated(!!data.truncated);
    } catch {
      setError('Načtení se nepovedlo.');
    } finally {
      setLoading(false);
    }
  }

  async function resolve(fingerprint: string) {
    const res = await fetch(`/api/admin/client-errors?fingerprint=${encodeURIComponent(fingerprint)}`, {
      method: 'DELETE',
      headers: await authHeader(),
    });
    if (!res.ok) {
      setError('Smazání se nepovedlo.');
      return;
    }
    setGroups((prev) => prev.filter((g) => g.fingerprint !== fingerprint));
  }

  async function purgeOld() {
    const res = await fetch('/api/admin/client-errors?olderThanDays=30', { method: 'DELETE', headers: await authHeader() });
    if (!res.ok) setError('Úklid se nepovedl.');
    else await load(days);
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>;

  if (!isAdmin) {
    return (
      <div className="auth-gate">
        <p>Tahle stránka je jen pro administrátory.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <p className="section-title">Chyby z prohlížečů</p>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">Co tu je</p>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, lineHeight: 1.7 }}>
          Neodchycené chyby JavaScriptu z prohlížečů návštěvníků, seskupené podle otisku (text chyby +
          místo v kódu). Posílá se jen text chyby, zásobník, adresa stránky bez parametrů, prohlížeč a
          třída zařízení - nic, co člověk napsal, a ne kdo to byl. „Vyřešeno" skupinu smaže; když se
          chyba vrátí, objeví se znovu.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {[1, 7, 30].map((d) => (
          <button
            key={d}
            type="button"
            className={days === d ? 'reports-filter reports-filter-active' : 'reports-filter'}
            onClick={() => setDays(d)}
          >
            {d === 1 ? 'Poslední den' : `Posledních ${d} dní`}
          </button>
        ))}
        <span style={{ fontSize: 13, color: 'var(--text-faint)', marginLeft: 'auto' }}>
          {total} {total === 1 ? 'záznam' : total < 5 ? 'záznamy' : 'záznamů'}
          {truncated ? ' (jen 2000 nejnovějších)' : ''} · {groups.length} skupin
        </span>
        <button type="button" onClick={purgeOld} title="Smaže záznamy starší než 30 dní">
          Uklidit starší než 30 dní
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading && <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Načítám…</p>}

      {!loading && groups.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
          Žádné chyby. Buď je všechno v pořádku, nebo migrace client_errors ještě neproběhla.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {groups.map((g) => {
            const isOpen = open === g.fingerprint;
            const devices = Object.entries(g.devices).sort((a, b) => b[1] - a[1]);
            return (
              <div key={g.fingerprint} className="panel" style={{ padding: 14 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span
                    style={{
                      minWidth: 44, textAlign: 'center', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      background: 'var(--panel-raised)', borderRadius: 8, padding: '4px 8px',
                    }}
                    title="Kolikrát se to stalo"
                  >
                    {g.count}×
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, wordBreak: 'break-word' }}>{g.message}</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
                      {g.kind === 'rejection' ? 'nezachycený promise' : 'chyba'} · naposled{' '}
                      {new Date(g.lastSeen).toLocaleString('cs-CZ')} · poprvé{' '}
                      {new Date(g.firstSeen).toLocaleString('cs-CZ')}
                    </p>
                    <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
                      {devices.map(([d, n]) => `${d} ${n}×`).join(' · ')}
                    </p>
                    {g.urls.length > 0 && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                        {g.urls.map((u) => `${u.url} (${u.count}×)`).join(' · ')}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : g.fingerprint)}>
                      {isOpen ? 'Skrýt' : 'Detail'}
                    </button>
                    <button type="button" onClick={() => resolve(g.fingerprint)} title="Smaže tuhle skupinu">
                      Vyřešeno
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 12 }}>
                    {g.sampleUserAgent && (
                      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-faint)', wordBreak: 'break-all' }}>
                        {g.sampleUserAgent}
                      </p>
                    )}
                    <pre
                      style={{
                        margin: 0, padding: 12, fontSize: 12, lineHeight: 1.5, overflowX: 'auto',
                        background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}
                    >
                      {g.sampleStack ?? '(bez zásobníku)'}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
