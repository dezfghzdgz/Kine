'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  REVENUE_TIERS,
  PARTNER_STATUS_LABELS,
  tierPercentFor,
  effectiveCreatorPercent,
  type PartnerStatus,
} from '@/lib/revenueShare';

/**
 * Stránka pro moderátora: kolik z výdělku dostává který tvůrce.
 *
 * Nováček startuje na 25 %, po dosažení cíle se posouvá na 55 %. Tady se
 * dá komukoliv nastavit vlastní procento - nahoru pro speciální partnery,
 * dolů jako sankce - a napsat k tomu důvod.
 */
export default function AdminRevenueSharePage() {
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [creators, setCreators] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { percent: string; status: PartnerStatus; note: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAndLoad();
  }, []);

  async function checkAndLoad() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setChecking(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', authData.user.id)
      .single();

    if (!profile?.is_admin) {
      setChecking(false);
      return;
    }

    setIsAdmin(true);
    await load('');
    setChecking(false);
  }

  async function load(searchTerm: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch(`/api/admin/revenue-share?search=${encodeURIComponent(searchTerm)}`, {
      headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    });
    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Načtení se nepovedlo.');
      return;
    }

    setError(null);
    setCreators(data.creators ?? []);

    // Rozpracované hodnoty se plní z databáze, ať se needituje naprázdno.
    const nextDrafts: Record<string, { percent: string; status: PartnerStatus; note: string }> = {};
    (data.creators ?? []).forEach((c: any) => {
      nextDrafts[c.id] = {
        percent: String(c.revenue_share_percent ?? 25),
        status: (c.partner_status ?? 'standard') as PartnerStatus,
        note: c.revenue_share_note ?? '',
      };
    });
    setDrafts(nextDrafts);
  }

  async function save(creatorId: string) {
    const draft = drafts[creatorId];
    if (!draft) return;

    setSavingId(creatorId);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/revenue-share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token}`,
      },
      body: JSON.stringify({
        creatorId,
        percent: Number.parseInt(draft.percent, 10),
        partnerStatus: draft.status,
        note: draft.note,
      }),
    });

    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Uložení se nepovedlo.');

    setSavingId(null);
    await load(search);
  }

  /** Zpátky na automatický podíl podle počtu odběratelů. */
  async function resetToAutomatic(creatorId: string) {
    setSavingId(creatorId);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/revenue-share', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token}`,
      },
      body: JSON.stringify({ creatorId, resetToAutomatic: true }),
    });

    const data = await res.json();
    if (!res.ok) setError(data.error ?? 'Uložení se nepovedlo.');

    setSavingId(null);
    await load(search);
  }

  function updateDraft(creatorId: string, patch: Partial<{ percent: string; status: PartnerStatus; note: string }>) {
    setDrafts((prev) => ({
      ...prev,
      [creatorId]: { ...prev[creatorId], ...patch },
    }));
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
      <p className="section-title">Rozdělení výdělků</p>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">Jak to funguje</p>
        <ul style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          {REVENUE_TIERS.map((tier) => (
            <li key={tier.minSubscribers}>
              od <strong>{tier.minSubscribers} odběratelů</strong>: tvůrce {tier.creatorPercent} %,
              Kine {100 - tier.creatorPercent} %
            </li>
          ))}
          <li>
            Ručně nastavené procento má přednost - použij ho na speciální partnery (nahoru)
            nebo jako sankci (dolů). Tvůrci o změně přijde oznámení.
          </li>
        </ul>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); load(search); }}
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <input
          type="text"
          placeholder="Hledat tvůrce podle jména…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit">Hledat</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {creators.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Žádní tvůrci k zobrazení.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {creators.map((c) => {
            const draft = drafts[c.id] ?? { percent: '25', status: 'standard' as PartnerStatus, note: '' };
            const earned = tierPercentFor(c.subscriberCount);
            const isManual = !!c.revenue_share_manual;
            const effective = effectiveCreatorPercent(
              c.revenue_share_percent,
              isManual,
              c.subscriberCount
            );
            // Prázdné pole nesmí projít jako nula, jinak by se tvůrci tiše
            // srazil podíl na 0 %.
            const percentNumber = Number.parseInt(draft.percent, 10);
            const invalid =
              draft.percent.trim() === '' ||
              !Number.isInteger(percentNumber) ||
              percentNumber < 0 ||
              percentNumber > 100;

            return (
              <div key={c.id} className="panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span className="profile-avatar-small" style={{ width: 32, height: 32, overflow: 'hidden' }}>
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt={c.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : null}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                      {c.display_name || c.username}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-faint)' }}>
                      {c.subscriberCount} odběratelů · podle stupně {earned} % ·
                      {' '}teď platí <strong style={{ color: 'var(--text-dim)' }}>{effective} %</strong>
                      {' '}({isManual ? 'nastaveno ručně' : 'automaticky'})
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    Podíl tvůrce (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.percent}
                      onChange={(e) => updateDraft(c.id, { percent: e.target.value })}
                      style={{ display: 'block', width: 100, marginTop: 4 }}
                    />
                  </label>

                  <label style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                    Stav
                    <select
                      value={draft.status}
                      onChange={(e) => updateDraft(c.id, { status: e.target.value as PartnerStatus })}
                      style={{ display: 'block', marginTop: 4 }}
                    >
                      {(Object.keys(PARTNER_STATUS_LABELS) as PartnerStatus[]).map((status) => (
                        <option key={status} value={status}>{PARTNER_STATUS_LABELS[status]}</option>
                      ))}
                    </select>
                  </label>

                  <label style={{ fontSize: 12, color: 'var(--text-faint)', flex: 1, minWidth: 200 }}>
                    Poznámka (proč)
                    <input
                      type="text"
                      value={draft.note}
                      onChange={(e) => updateDraft(c.id, { note: e.target.value })}
                      placeholder="např. dlouhodobý partner"
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => save(c.id)}
                    disabled={savingId === c.id || invalid}
                  >
                    {savingId === c.id ? 'Ukládám…' : 'Uložit'}
                  </button>

                  {isManual && (
                    <button
                      type="button"
                      onClick={() => resetToAutomatic(c.id)}
                      disabled={savingId === c.id}
                      style={{ background: 'var(--panel-raised)', color: 'var(--text)' }}
                    >
                      Zpět na automatický
                    </button>
                  )}
                </div>

                <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '10px 0 0' }}>
                  {invalid
                    ? 'Zadej celé číslo od 0 do 100.'
                    : `Po uložení: tvůrce ${percentNumber} %, Kine ${100 - percentNumber} %`}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
