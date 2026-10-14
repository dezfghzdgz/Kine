'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import { useUserRole } from '@/lib/useUserRole';
import {
  CUSTOM_BADGE_COLORS,
  CUSTOM_BADGE_DESC_MAX,
  CUSTOM_BADGE_ICONS,
  CUSTOM_BADGE_IMAGE_MAX_BYTES,
  CUSTOM_BADGE_NAME_MAX,
  SPECIAL_BADGES,
  customBadgeId,
  type Badge,
  type CustomBadgeDef,
  type SpecialBadgeId,
} from '@/lib/badges';
import { BADGE_ICONS, badgeTexts, badgeTierClass } from '@/lib/badgeText';
import { BadgePill } from '@/components/ChannelBadges';
import UiIcon, { type UiIconName } from '@/components/UiIcon';
import ProfileImage from '@/components/ProfileImage';

type Row = { id: string; username: string; displayName: string | null; avatarUrl: string | null; special: SpecialBadgeId[]; custom: string[] };
type Draft = { id: string | null; name: string; description: string; icon: string; color: string; image: string | null };

const EMPTY_DRAFT: Draft = { id: null, name: '', description: '', icon: 'starFilled', color: CUSTOM_BADGE_COLORS[1], image: null };

/** Odznak z rozpracovaného formuláře - náhled vypadá stejně jako na kanálu. */
function draftBadge(d: Draft): Badge {
  const def: CustomBadgeDef = { id: d.id ?? '00000000-0000-4000-8000-000000000000', name: d.name || '…', description: d.description || null, icon: d.icon, color: d.color, image: d.image };
  return { id: customBadgeId(def.id), level: 0, value: 1, custom: def };
}

function customAsBadge(def: CustomBadgeDef): Badge {
  return { id: customBadgeId(def.id), level: 0, value: 1, custom: def };
}

/**
 * Tým Kine (moderátor nebo správce): speciální a vlastní odznaky.
 *  - Vlastní odznaky: název, popis, ikona, barva, vlastní obrázek nebo GIF
 *    (app/api/admin/badges/custom, .../image).
 *  - Přidělení: najdi uživatele a klikni na odznak (app/api/admin/badges).
 *    Majitele Kine přiděluje jen správce.
 * Na kanálu se odznak ukáže hned (majiteli; ostatním z mezipaměti do 5 minut)
 * a dotyčný dostane oslavu a oznámení jako u každého nového odznaku.
 */
export default function AdminBadgesPage() {
  const { t, lang } = useLanguage();
  const { isAdmin, isModerator, loading } = useUserRole();
  // Moderátor i správce (server kontroluje totéž - lib/badgeAdmin.ts).
  const allowed = isAdmin || isModerator;
  const text = badgeTexts(t, lang);
  const [users, setUsers] = useState<Row[]>([]);
  const [custom, setCustom] = useState<CustomBadgeDef[]>([]);
  const [canOwner, setCanOwner] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
    setMissing(!!body.customMissing);
    setUsers(body.users ?? []);
    setCustom(body.custom ?? []);
    setCanOwner(body.canOwner === true);
  }

  useEffect(() => {
    if (allowed) void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  async function toggle(user: Row, badge: string, on: boolean) {
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
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, special: body.special ?? u.special, custom: body.custom ?? u.custom } : u)));
    } finally {
      setBusy(null);
    }
  }

  async function uploadImage(file: File) {
    setDraftError(null);
    if (file.size > CUSTOM_BADGE_IMAGE_MAX_BYTES) {
      setDraftError(t('customBadgeImageTooBig'));
      return;
    }
    setUploading(true);
    try {
      const res = await fetch('/api/admin/badges/image', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream', Authorization: `Bearer ${await token()}` },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body?.url !== 'string') {
        setDraftError(body?.error ?? String(res.status));
        return;
      }
      setDraft((d) => (d ? { ...d, image: body.url } : d));
    } finally {
      setUploading(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setSaving(true);
    setDraftError(null);
    try {
      const payload = { name: draft.name, description: draft.description, icon: draft.icon, color: draft.color, image: draft.image };
      const res = await fetch('/api/admin/badges/custom', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(draft.id ? { id: draft.id, ...payload } : payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.badge) {
        setDraftError(body?.error ?? String(res.status));
        return;
      }
      const saved = body.badge as CustomBadgeDef;
      setCustom((list) => (list.some((c) => c.id === saved.id) ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved]));
      setDraft(null);
    } finally {
      setSaving(false);
    }
  }

  async function removeCustom(def: CustomBadgeDef) {
    if (!window.confirm(t('customBadgeDeleteConfirm').replace('{name}', def.name))) return;
    setBusy(`custom:${def.id}`);
    try {
      const res = await fetch(`/api/admin/badges/custom?id=${encodeURIComponent(def.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? String(res.status));
        return;
      }
      setCustom((list) => list.filter((c) => c.id !== def.id));
      setUsers((list) => list.map((u) => ({ ...u, custom: u.custom.filter((id) => id !== def.id) })));
      if (draft?.id === def.id) setDraft(null);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return null;
  if (!allowed) {
    return (
      <div className="auth-gate">
        <p>{t('badgesAdminDenied')}</p>
      </div>
    );
  }

  return (
    <div className="form-container admin-badges" style={{ maxWidth: 900 }}>
      <h1 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <UiIcon name="trophy" size={22} />
        {t('specialBadgesAdminLabel')}
      </h1>
      <p style={{ color: 'var(--text-dim)', marginTop: 0 }}>{t('badgesAdminIntro')}</p>
      {missing && <p className="error-text">{t('badgesMissingMigration')}</p>}
      {error && <p className="error-text">{error}</p>}

      {/* ---- Vlastní odznaky ---- */}
      <section className="panel admin-custom-badges">
        <div className="admin-custom-head">
          <p className="panel-heading" style={{ margin: 0 }}>
            {t('customBadgesTitle')}
          </p>
          {!draft && !missing && (
            <button
              type="button"
              className="admin-custom-new"
              onClick={() => {
                setDraftError(null);
                setDraft({ ...EMPTY_DRAFT });
              }}
            >
              <UiIcon name="plus" size={15} />
              {t('customBadgeNew')}
            </button>
          )}
        </div>
        {custom.length === 0 && !draft && <p style={{ color: 'var(--text-faint)', margin: 0 }}>{t('customBadgesEmpty')}</p>}
        {custom.length > 0 && (
          <div className="admin-custom-list">
            {custom.map((def) => (
              <div key={def.id} className="admin-custom-item">
                <BadgePill badge={customAsBadge(def)} label={def.name} tip={def.description ?? undefined} />
                <button
                  type="button"
                  className="icon-btn admin-custom-edit"
                  title={t('customBadgeEdit')}
                  aria-label={t('customBadgeEdit')}
                  onClick={() => {
                    setDraftError(null);
                    setDraft({ id: def.id, name: def.name, description: def.description ?? '', icon: def.icon, color: def.color, image: def.image });
                  }}
                >
                  <UiIcon name="pencil" size={15} />
                </button>
                <button type="button" className="icon-btn admin-custom-delete" title={t('customBadgeDelete')} aria-label={t('customBadgeDelete')} disabled={busy === `custom:${def.id}`} onClick={() => void removeCustom(def)}>
                  <UiIcon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {draft && (
          <div className="admin-custom-form">
            <p className="appearance-label" style={{ marginTop: 0 }}>
              {draft.id ? t('customBadgeEditTitle') : t('customBadgeNew')}
            </p>
            <div className="admin-custom-preview">
              <BadgePill badge={draftBadge(draft)} label={draft.name || '…'} size="lg" />
            </div>
            <label className="admin-custom-field">
              <span>{t('customBadgeName')}</span>
              <input type="text" value={draft.name} maxLength={CUSTOM_BADGE_NAME_MAX} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="admin-custom-name" />
            </label>
            <label className="admin-custom-field">
              <span>{t('customBadgeDesc')}</span>
              <input type="text" value={draft.description} maxLength={CUSTOM_BADGE_DESC_MAX} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="admin-custom-desc" />
            </label>
            <div className="admin-custom-field">
              <span>{t('customBadgeIcon')}</span>
              <div className="admin-custom-icons" role="radiogroup" aria-label={t('customBadgeIcon')}>
                {CUSTOM_BADGE_ICONS.map((icon) => (
                  <button key={icon} type="button" role="radio" aria-checked={draft.icon === icon} className={`admin-custom-icon ${draft.icon === icon ? 'active' : ''}`} onClick={() => setDraft({ ...draft, icon })} title={icon}>
                    <UiIcon name={icon as UiIconName} size={17} />
                  </button>
                ))}
              </div>
            </div>
            <div className="admin-custom-field">
              <span>{t('customBadgeColor')}</span>
              <div className="admin-custom-colors">
                {CUSTOM_BADGE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`admin-custom-color ${draft.color === c ? 'active' : ''}`}
                    style={{ background: c }}
                    aria-label={c}
                    aria-pressed={draft.color === c}
                    onClick={() => setDraft({ ...draft, color: c })}
                  />
                ))}
                <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value.toLowerCase() })} aria-label={t('customBadgeColor')} className="admin-custom-color-input" />
              </div>
            </div>
            <div className="admin-custom-field">
              <span>{t('customBadgeImage')}</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="appearance-reset admin-custom-image-pick" onClick={() => fileInput.current?.click()} disabled={uploading}>
                  <UiIcon name="image" size={15} />
                  <span>{uploading ? t('customBadgeUploading') : t('customBadgeImagePick')}</span>
                </button>
                {draft.image && (
                  <button type="button" className="appearance-reset" onClick={() => setDraft({ ...draft, image: null })}>
                    <UiIcon name="close" size={15} />
                    <span>{t('customBadgeImageRemove')}</span>
                  </button>
                )}
              </div>
              <small style={{ color: 'var(--text-faint)' }}>{t('customBadgeImageHint')}</small>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                className="admin-custom-file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void uploadImage(file);
                }}
              />
            </div>
            {draftError && (
              <p className="error-text" style={{ margin: 0 }}>
                {draftError}
              </p>
            )}
            <div className="admin-custom-actions">
              <button type="button" className="admin-custom-cancel" onClick={() => setDraft(null)}>
                {t('customBadgeCancel')}
              </button>
              <button type="button" className="admin-custom-save" disabled={saving || uploading || !draft.name.trim()} onClick={() => void saveDraft()}>
                {saving ? '…' : draft.id ? t('customBadgeSave') : t('customBadgeCreate')}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---- Přidělit ---- */}
      <p className="panel-heading" style={{ margin: '18px 0 8px' }}>
        {t('badgesAssignTitle')}
      </p>
      <form
        className="panel"
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void load(search);
        }}
      >
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('specialBadgesSearch')} style={{ flex: 1 }} aria-label={t('specialBadgesSearch')} />
        <button type="submit" aria-label={t('specialBadgesSearch')}>
          <UiIcon name="search" size={16} />
        </button>
      </form>
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
                const locked = id === 'owner' && !canOwner;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`badge-pill ${on ? badgeTierClass({ id, level: 0 }) : 'tier-locked admin-badge-off'}`}
                    aria-pressed={on}
                    disabled={busy === `${u.id}:${id}` || locked}
                    onClick={() => void toggle(u, id, !on)}
                    title={locked ? t('badgesOwnerAdminOnly') : text.tip(id, 1)}
                  >
                    <span className="badge-medal" aria-hidden="true">
                      <UiIcon name={on ? BADGE_ICONS[id] : locked ? 'lock' : 'plus'} size={13} />
                    </span>
                    {text.label(id, 1)}
                  </button>
                );
              })}
              {custom.map((def) => {
                const on = u.custom.includes(def.id);
                const key = customBadgeId(def.id);
                return on ? (
                  <button
                    key={def.id}
                    type="button"
                    className="admin-custom-chip"
                    aria-pressed="true"
                    disabled={busy === `${u.id}:${key}`}
                    onClick={() => void toggle(u, key, false)}
                    title={def.description ?? def.name}
                  >
                    <BadgePill badge={customAsBadge(def)} label={def.name} />
                  </button>
                ) : (
                  <button
                    key={def.id}
                    type="button"
                    className="badge-pill tier-locked admin-badge-off"
                    aria-pressed="false"
                    disabled={busy === `${u.id}:${key}`}
                    onClick={() => void toggle(u, key, true)}
                    title={def.description ?? def.name}
                  >
                    <span className="badge-medal" aria-hidden="true">
                      <UiIcon name="plus" size={13} />
                    </span>
                    {def.name}
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
