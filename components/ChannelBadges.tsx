'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/lib/i18n';
import { supabase } from '@/lib/supabaseClient';
import {
  badgeProgress,
  computeBadges,
  nextBadge,
  sanitizeShowcase,
  showcaseBadges,
  SHOWCASE_MAX,
  type Badge,
  type BadgeId,
  type BadgeStats,
} from '@/lib/badges';
import { BADGE_ICONS, badgeTexts, badgeTierClass, badgeTierName } from '@/lib/badgeText';
import UiIcon from './UiIcon';

/**
 * Odznaky pod jménem kanálu (lib/badges.ts).
 *
 * Na kanálu jsou nejvýš tři - ty, které si majitel vybral (jako v Clash
 * Royale), dokud nevybral, tři nejvýraznější. Barva podle stupně: bronz,
 * stříbro, zlato, platina, diamant. "+N" a tužka otevřou sbírku: všechny
 * řady, získané i zamčené, s postupem k dalšímu stupni; majitel v ní
 * vybírá, které ukáže. Majitel navíc vidí, který odznak má nejblíž.
 */
export default function ChannelBadges({
  stats,
  own,
  showcase,
  onShowcaseSaved,
  openOnLoad = false,
}: {
  stats: BadgeStats;
  own: boolean;
  /** profiles.badge_showcase - null = ještě nevybíral (nebo chybí migrace). */
  showcase: unknown;
  onShowcaseSaved?: (next: BadgeId[]) => void;
  /** Otevřít sbírku hned (odkaz z oznámení: ?badges=1). */
  openOnLoad?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const earned = computeBadges(stats);
  const shown = showcaseBadges(earned, showcase);
  const next = own ? nextBadge(stats) : null;
  const text = badgeTexts(t, lang);

  useEffect(() => {
    if (openOnLoad) setOpen(true);
  }, [openOnLoad]);

  if (earned.length === 0 && !next && !own) return null;
  const hidden = earned.length - shown.length;

  return (
    <>
      <div className="channel-badges" aria-label={t('badgesLabel')}>
        {shown.map((b) => (
          <BadgePill key={b.id} badge={b} label={text.label(b.id, b.value)} tip={text.tip(b.id, b.value)} />
        ))}
        {hidden > 0 && (
          <button type="button" className="channel-badge-more" onClick={() => setOpen(true)} title={t('badgesAll')}>
            +{hidden}
          </button>
        )}
        {own && (
          <button type="button" className="channel-badge-edit" onClick={() => setOpen(true)} title={t('badgesEdit')} aria-label={t('badgesEdit')}>
            <UiIcon name="pencil" size={13} />
          </button>
        )}
        {next && (
          <span className="channel-badge-next" title={t('badgeNextTip')}>
            <UiIcon name={BADGE_ICONS[next.id]} size={13} />
            {t('badgeNext').replace('{badge}', text.label(next.id, next.target)).replace('{missing}', text.number(next.missing))}
          </span>
        )}
      </div>
      {open && (
        <BadgeCollection
          stats={stats}
          own={own}
          showcase={showcase}
          onClose={() => setOpen(false)}
          onSaved={(picked) => {
            onShowcaseSaved?.(picked);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** Odznak jako medaile s textem - stejný v hlavičce kanálu i v oslavném okénku. */
export function BadgePill({ badge, label, tip, size = 'md' }: { badge: Badge; label: string; tip?: string; size?: 'md' | 'lg' }) {
  return (
    <span className={`badge-pill ${badgeTierClass(badge)} ${size === 'lg' ? 'badge-pill-lg' : ''}`} title={tip}>
      <span className="badge-medal" aria-hidden="true">
        <UiIcon name={BADGE_ICONS[badge.id]} size={size === 'lg' ? 18 : 13} />
      </span>
      {label}
    </span>
  );
}

/** Sbírka všech odznaků; majitel v ní vybírá až tři na kanál. */
function BadgeCollection({
  stats,
  own,
  showcase,
  onClose,
  onSaved,
}: {
  stats: BadgeStats;
  own: boolean;
  showcase: unknown;
  onClose: () => void;
  onSaved: (picked: BadgeId[]) => void;
}) {
  const { t, lang } = useLanguage();
  const text = badgeTexts(t, lang);
  const progress = badgeProgress(stats);
  const earned = computeBadges(stats);
  const [picked, setPicked] = useState<BadgeId[]>(() => showcaseBadges(earned, showcase).map((b) => b.id));
  const [full, setFull] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Uložený výběr - tlačítko Uložit má smysl, jen když se od něj liší (null = ještě nevybíral).
  const savedPick = sanitizeShowcase(showcase);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggle(id: BadgeId) {
    setError(null);
    if (picked.includes(id)) {
      setPicked(picked.filter((x) => x !== id));
      setFull(false);
      return;
    }
    if (picked.length >= SHOWCASE_MAX) {
      setFull(true);
      return;
    }
    setPicked([...picked, id]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setSaving(false);
      return;
    }
    const { error: saveError } = await supabase.from('profiles').update({ badge_showcase: picked }).eq('id', auth.user.id);
    setSaving(false);
    if (saveError) {
      setError(t('badgesSaveFailed').replace('{error}', saveError.message));
      return;
    }
    onSaved(picked);
  }

  const unchanged = savedPick !== null && JSON.stringify(picked) === JSON.stringify(savedPick);

  // Do <body>: uvnitř hlavičky kanálu (vlastní vrstva) by okno i se z-indexem zůstalo
  // pod horní lištou - ta zakrývala jeho nadpis a s víc odznaky i první řadu.
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="badge-modal-backdrop" onClick={onClose}>
      <div className="panel modal-glass badge-modal" role="dialog" aria-modal="true" aria-label={t('badgesLabel')} onClick={(e) => e.stopPropagation()}>
        <div className="badge-modal-head">
          <span className="badge-modal-icon" aria-hidden="true">
            <UiIcon name="trophy" size={20} />
          </span>
          <div className="badge-modal-title">
            <p className="panel-heading" style={{ margin: 0 }}>
              {t('badgesLabel')} <span className="badge-modal-count">{earned.length}/{progress.length}</span>
            </p>
            {own && <p className={`badge-modal-hint ${full ? 'warn' : ''}`}>{full ? t('badgesPickFull') : t('badgesPickHint')}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('close')} title={t('close')}>
            <UiIcon name="close" size={16} />
          </button>
        </div>

        <div className="badge-grid">
          {progress.map((p) => {
            const badge = p.badge;
            const selected = badge ? picked.includes(p.id) : false;
            const order = selected ? picked.indexOf(p.id) + 1 : 0;
            const ratio = p.next ? Math.max(0, Math.min(1, p.current / p.next)) : 1;
            const body = (
              <>
                <span className={`badge-medal badge-medal-lg ${badge ? badgeTierClass(badge) : 'tier-locked'}`} aria-hidden="true">
                  <UiIcon name={badge ? BADGE_ICONS[p.id] : 'lock'} size={22} />
                </span>
                <span className="badge-tile-name">{badge ? text.label(p.id, badge.value) : text.series(p.id)}</span>
                <span className="badge-tile-meta">
                  {badge && p.tiers > 1
                    ? `${badgeTierName(badge.level, t)} · ${
                        p.next === null ? t('badgesTopTier') : t('badgesTier').replace('{n}', String(badge.level + 1)).replace('{total}', String(p.tiers))
                      }`
                    : badge
                      ? t('badgesUnlocked')
                      : t('badgesLocked')}
                </span>
                {p.next !== null && (
                  <>
                    <span className="badge-tile-progress" aria-hidden="true">
                      <span style={{ width: `${ratio * 100}%` }} />
                    </span>
                    <span className="badge-tile-next">
                      {text.number(p.current)} / {text.number(p.next)}
                    </span>
                  </>
                )}
                {selected && <span className="badge-tile-order">{order}</span>}
              </>
            );
            const tip = badge ? text.tip(p.id, badge.value) : text.tip(p.id, p.next ?? 1);
            return own && badge ? (
              <button key={p.id} type="button" className={`badge-tile ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggle(p.id)} title={tip}>
                {body}
              </button>
            ) : (
              <div key={p.id} className={`badge-tile ${badge ? '' : 'locked'}`} title={tip}>
                {body}
              </div>
            );
          })}
        </div>

        {own && (
          <div className="badge-modal-actions">
            {error ? <p className="error-text badge-modal-error">{error}</p> : <span className="badge-modal-picked">{t('badgesShownCount').replace('{n}', String(picked.length)).replace('{max}', String(SHOWCASE_MAX))}</span>}
            <button type="button" className="badge-modal-save" onClick={() => void save()} disabled={saving || unchanged}>
              {saving ? '…' : t('save')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
