'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const TIERS = [
  { value: 'basic', label: 'Základní (šedá)' },
  { value: 'silver', label: 'Stříbrná' },
  { value: 'blue', label: 'Modrá (nejvyšší)' },
];

export default function AdminVerificationsPage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [selectedTier, setSelectedTier] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setChecking(false);
      return;
    }

    const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', authData.user.id).single();
    if (!profile?.is_admin) {
      setChecking(false);
      return;
    }
    setIsAdmin(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/verification-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const data = await res.json();
    setRequests(data.requests ?? []);
    setChecking(false);
  }

  async function review(requestId: string, action: 'approve' | 'reject') {
    const { data: sessionData } = await supabase.auth.getSession();
    await fetch('/api/admin/verification-requests/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token}`,
      },
      body: JSON.stringify({ requestId, action, tier: selectedTier[requestId] ?? 'basic' }),
    });
    load();
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>Načítám…</p>;

  if (!isAdmin) {
    return <p>Tahle stránka je jen pro administrátory.</p>;
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const reviewed = requests.filter((r) => r.status !== 'pending');

  return (
    <div style={{ maxWidth: 640 }}>
      <p className="section-title">Žádosti o ověření</p>

      {pending.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>Žádné čekající žádosti.</p>
      ) : (
        pending.map((r) => (
          <div key={r.id} className="panel" style={{ marginBottom: 14 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{r.profiles?.display_name ?? r.profiles?.username}</p>
            <p style={{ margin: '4px 0 10px', fontSize: 12, color: 'var(--text-faint)' }}>
              {r.subscriber_count_at_request} odběratelů v době žádosti · {new Date(r.created_at).toLocaleDateString('cs-CZ')}
            </p>

            <select
              value={selectedTier[r.id] ?? 'basic'}
              onChange={(e) => setSelectedTier({ ...selectedTier, [r.id]: e.target.value })}
              style={{ marginBottom: 10 }}
            >
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => review(r.id, 'approve')} style={{ flex: 1 }}>Schválit</button>
              <button
                onClick={() => review(r.id, 'reject')}
                style={{ flex: 1, background: 'var(--panel-raised)', color: '#ff6b6b' }}
              >
                Zamítnout
              </button>
            </div>
          </div>
        ))
      )}

      {reviewed.length > 0 && (
        <>
          <p className="panel-heading" style={{ marginTop: 24 }}>Vyřízené žádosti</p>
          {reviewed.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{r.profiles?.display_name ?? r.profiles?.username}</span>
              <span style={{ color: r.status === 'approved' ? '#4ade80' : '#ff6b6b' }}>
                {r.status === 'approved' ? 'Schváleno' : 'Zamítnuto'}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
