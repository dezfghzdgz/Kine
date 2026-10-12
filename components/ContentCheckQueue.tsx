'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';

type Item = {
  id: number;
  kind: 'video' | 'live';
  verdict: 'hidden' | 'review';
  reason: string;
  status: 'open' | 'approved' | 'removed';
  artistic: boolean;
  createdAt: string;
  reviewedAt: string | null;
  channel: { id: string; name: string };
  video: { id: string; title: string; visibility: string; hold: string | null } | null;
  strikes: number | null;
  frames: { url: string; porn: number | null; sexy: number | null; t: number | null }[];
};

/**
 * Fronta automatické kontroly nahoty a porna (v /reports, jen moderátoři).
 * Snímky jsou rozmazané, dokud na ně moderátor neklikne. "Pustit" vrátí
 * video / přenos (omyl modelu, umění), "Nechat skryté" ho ponechá skryté
 * a autorovi přijde oznámení. Data i akce jdou přes /api/moderation/content.
 */
export default function ContentCheckQueue() {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<Item[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [working, setWorking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(all = showDone) {
    try {
      const res = await fetch(`/api/moderation/content?status=${all ? 'all' : 'open'}`, { cache: 'no-store', headers: await authHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setItems([]);
        return;
      }
      setAvailable(body.available !== false);
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    load(showDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDone]);

  async function act(item: Item, action: 'approve' | 'remove') {
    setWorking(item.id);
    setError(null);
    try {
      const res = await fetch('/api/moderation/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ id: item.id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? t('contentCheckFailed'));
        return;
      }
      await load();
    } finally {
      setWorking(null);
    }
  }

  if (items === null) return null;
  if (!available) {
    return (
      <div className="panel content-check" style={{ marginBottom: 20 }}>
        <p className="panel-heading" style={{ marginBottom: 4 }}>{t('contentCheckTitle')}</p>
        <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>{t('contentCheckUnavailable')}</p>
      </div>
    );
  }

  const open = items.filter((i) => i.status === 'open');
  const pct = (n: number | null) => (n === null ? '—' : String(Math.round(n * 100)));

  return (
    <div className="panel content-check" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <p className="panel-heading" style={{ margin: 0 }}>
          {t('contentCheckTitle')} {open.length > 0 && <span className="content-check-count">{open.length}</span>}
        </p>
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-dim)' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          {t('contentCheckShowDone')}
        </label>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 12px' }}>{t('contentCheckHint')}</p>
      {error && <p className="error-text">{error}</p>}
      {items.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>{t('contentCheckEmpty')}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((item) => {
          const show = revealed.has(item.id);
          const href = item.kind === 'live' ? `/live/${item.channel.id}` : item.video ? `/watch/${item.video.id}` : null;
          return (
            <div key={item.id} className={`content-check-item ${item.status !== 'open' ? 'done' : ''}`}>
              <div className="content-check-head">
                <span className={`content-check-badge ${item.verdict}`}>
                  {item.kind === 'live' ? '🔴 ' : ''}
                  {item.verdict === 'hidden' ? t('contentCheckHidden') : t('contentCheckReview')}
                </span>
                <span className="content-check-badge reason">{item.reason === 'porn' ? t('contentCheckPorn') : t('contentCheckNudity')}</span>
                {item.artistic && <span className="content-check-badge art">🎨 {t('contentCheckArtistic')}</span>}
                {item.status !== 'open' && (
                  <span className="content-check-badge state">{item.status === 'approved' ? t('contentCheckApproved') : t('contentCheckRemoved')}</span>
                )}
              </div>
              <p className="content-check-title">
                {href ? <Link href={href}>{item.kind === 'live' ? t('contentCheckLive') : item.video?.title ?? '—'}</Link> : '—'}
              </p>
              <p className="content-check-meta">
                <Link href={`/channel/${item.channel.id}`}>{item.channel.name}</Link> · {new Date(item.createdAt).toLocaleString(DATE_LOCALES[lang])}
                {item.kind === 'live' && item.strikes !== null && <> · {t('contentCheckStrikes').replace('{n}', String(item.strikes))}</>}
              </p>
              {item.frames.length > 0 && (
                <button
                  type="button"
                  className={`content-check-frames ${show ? 'shown' : ''}`}
                  onClick={() =>
                    setRevealed((prev) => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                  aria-label={t('contentCheckReveal')}
                  title={t('contentCheckReveal')}
                >
                  {item.frames.map((f, i) => (
                    <span key={i} className="content-check-frame">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                      {(f.porn !== null || f.sexy !== null) && (
                        <span className="content-check-score">{t('contentCheckScores').replace('{porn}', pct(f.porn)).replace('{sexy}', pct(f.sexy))}</span>
                      )}
                    </span>
                  ))}
                  {!show && <span className="content-check-reveal">👁 {t('contentCheckReveal')}</span>}
                </button>
              )}
              {item.status === 'open' && (
                <div className="report-group-actions">
                  <button type="button" onClick={() => act(item, 'approve')} disabled={working === item.id}>
                    ✓ {t('contentCheckApprove')}
                  </button>
                  <button type="button" className="content-check-remove" onClick={() => act(item, 'remove')} disabled={working === item.id}>
                    ⛔ {item.verdict === 'hidden' ? t('contentCheckRemove') : t('contentCheckRemoveReview')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
