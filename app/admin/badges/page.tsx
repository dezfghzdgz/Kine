'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { useUserRole } from '@/lib/useUserRole';
import { SPECIAL_BADGES, type SpecialBadgeId } from '@/lib/badges';
import { BADGE_ICONS, badgeTexts, badgeTierClass } from '@/lib/badgeText';
import UiIcon from '@/components/UiIcon';
import ProfileImage from '@/components/ProfileImage';

type Row = { id: string; username: string; displayName: string | null; avatarUrl: string | null; special: SpecialBadgeId[] };

/**
 * Správce: speciální odznaky (Majitel, Vývojář, Tým Kine, Moderátor, Beta
 * tester, Partner, Lovec chyb). Bez hledání ukazuje, kdo nějaký má; klik na
 * odznak ho přidá / odebere (app/api/admin/badges). Na kanálu se ukáže do
 * 5 minut (čísla odznaků jsou z mezipaměti) a dotyčný dostane oslavu
 * a oznámení jako u každého nového odznaku.
 */
export default function AdminBadgesPage() {
  const { t, lang } = useLanguage();
  const { isAdmin: adminFlag, role, loading } = useUserRole();
  // Správce: is_admin, nebo role admin (server kontroluje totéž).
  const isAdmin = adminFlag || role === 'admin';
  const text = badgeTexts(t, lang);
  const [users, setUsers] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function token(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  }

  async function load(term: string) {
    setError(null);
    const res = await fetch(`/api/admin/badges?search=${encodeURIComponent(term)}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (body?.code === 'not-migrated') {
      setMissing(true);
      setUsers([]);
      return;
    }
    if (!res.ok) {
      setError(body?.error ?? String(res.status));
      return;
    }
    setMissing(false);
    setUsers(body.users ?? []);
  }

  useEffect(() => {
    if (isAdmin) void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function toggle(user: Row, badge: SpecialBadgeId) {
    const on = !user.special.includes(badge);
    setBusy(`${user.id}:${badge}`);
    setError(null);
    try {
      const res = await fetch('/api/admin/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ userId: user.id, badge, on }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? String(res.status));
        return;
      }
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, special: body.special ?? u.special } : u)));
    } finally {
      setBusy(null);
    }
  }

  if (loading) return null;
  if (!isAdmin) {
    return (
      <div className="auth-gate">
        <p>Tahle stránka je jen pro administrátory.</p>
      </div>
    );
  }

  return (
    <div className="form-container admin-badges" style={{ maxWidth: 860 }}>
      <h1 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <UiIcon name="trophy" size={22} />
        {t('specialBadgesAdminLabel')}
      </h1>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>{t('specialBadgesAdminIntro')}</p>
      <form
        className="panel"
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
      >
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('specialBadgesSearch')} style={{ flex: 1 }} aria-label={t('specialBadgesSearch')} />
        <button type="submit">
          <UiIcon name="search" size={16} />
        </button>
      </form>
      {missing && <p className="error-text">{t('specialBadgesMissing')}</p>}
      {error && <p className="error-text">{error}</p>}
      {!missing && users.length === 0 && !search && <p style={{ color: 'var(--text-faint)' }}>{t('specialBadgesNone')}</p>}
      <div className="admin-badges-list">
        {users.map((u) => (
          <div key={u.id} className="panel admin-badges-row">
            <Link href={`/channel/${u.id}`} className="admin-badges-user">
              <span className="profile-avatar-small" style={{ width: 34, height: 34 }}>
                {u.avatarUrl ? <ProfileImage src={u.avatarUrl} alt={u.username} /> : null}
              </span>
              <span>
                <b>{u.displayName || u.username}</b>
                <span className="admin-badges-handle">@{u.username}</span>
              </span>
            </Link>
            <div className="admin-badges-chips">
              {SPECIAL_BADGES.map((id) => {
                const on = u.special.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`badge-pill ${on ? badgeTierClass({ id, level: 0 }) : 'tier-locked admin-badge-off'}`}
                    aria-pressed={on}
                    disabled={busy === `${u.id}:${id}`}
                    onClick={() => void toggle(u, id)}
                    title={text.tip(id, 1)}
                  >
                    <span className="badge-medal" aria-hidden="true">
                      <UiIcon name={on ? BADGE_ICONS[id] : 'plus'} size={13} />
                    </span>
                    {text.label(id, 1)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
