'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { liveElapsed } from '@/lib/liveChat';
import { authHeaders } from '@/lib/authHeaders';
import VerifiedBadge from './VerifiedBadge';

export type LiveItem = {
  ownerId: string;
  title: string;
  category?: string | null;
  startedAt: string | null;
  videoUid: string | null;
  followed?: boolean;
  /** Kolik lidí se dívá (jen s ?viewers=1, jinak null). */
  viewers?: number | null;
  profile: { id: string; username: string; displayName: string | null; avatarUrl: string | null; verificationTier: string | null };
};

/** Na hlavní stránce nejvýš tolik přenosů - všechny jsou na stránce Živě (/streams). */
const HOME_LIMIT = 8;

/**
 * Řada "Živě" na hlavní stránce - kdo teď vysílá. Když nikdo, nevykreslí
 * se nic. Obnovuje se každých 20 s (jen když je karta prohlížeče vidět).
 */
export default function LiveNowRow() {
  const { t } = useLanguage();
  const [streams, setStreams] = useState<LiveItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.hidden) return;
      try {
        // S přihlášením: vlastní přenos a odebírané kanály jdou dopředu (lib/liveNow.ts).
        const res = await fetch('/api/live/now', { cache: 'no-store', headers: await authHeaders() });
        const body = await res.json().catch(() => null);
        if (!cancelled && body && Array.isArray(body.streams)) setStreams(body.streams);
      } catch {
        // Bez sítě se řada prostě neukáže.
      }
    }
    load();
    const refresh = setInterval(load, 20 * 1000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, []);

  if (streams.length === 0) return null;

  return (
    <section className="live-now" aria-label={t('liveNowHeading')}>
      <div className="live-now-head">
        <p className="section-title" style={{ margin: 0 }}>
          <span className="live-dot" aria-hidden="true" /> {t('liveNowHeading')}
        </p>
        <Link href="/streams" className="live-now-all">
          {streams.length > HOME_LIMIT ? t('liveNowSeeAllCount').replace('{count}', String(streams.length)) : t('liveNowSeeAll')} →
        </Link>
      </div>
      <div className="live-now-grid">
        {streams.slice(0, HOME_LIMIT).map((s) => (
          <LiveCard key={s.ownerId} item={s} now={now} />
        ))}
      </div>
    </section>
  );
}

/** Karta přenosu: náhled (každou minutu nový), LIVE, diváci, jak dlouho běží, kanál. */
export function LiveCard({ item, now, showCategory = false }: { item: LiveItem; now: number; showCategory?: boolean }) {
  const { t } = useLanguage();
  const [thumbFailed, setThumbFailed] = useState(false);
  const name = item.profile.displayName || item.profile.username;
  // Náhled běžícího přenosu od Cloudflare; když ho nedá, zůstane avatar na tmavém pozadí.
  const thumb = item.videoUid && !thumbFailed ? `https://videodelivery.net/${item.videoUid}/thumbnails/thumbnail.jpg?height=360&t=${Math.floor(now / 60000)}` : null;
  return (
    <Link href={`/live/${item.ownerId}`} className="live-card">
      <div className="live-card-thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" onError={() => setThumbFailed(true)} />
        ) : (
          <span className="live-card-avatar">{item.profile.avatarUrl ? <img src={item.profile.avatarUrl} alt="" /> : null}</span>
        )}
        <span className="live-pill">● {t('liveBadge')}</span>
        {typeof item.viewers === 'number' && (
          <span className="live-card-viewers" title={t('streamsViewersTitle')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {item.viewers}
          </span>
        )}
        {item.startedAt && <span className="live-card-elapsed">{liveElapsed(item.startedAt, now)}</span>}
      </div>
      <div className="live-card-body">
        <span className="live-card-face" aria-hidden="true">
          {item.profile.avatarUrl ? <img src={item.profile.avatarUrl} alt="" loading="lazy" decoding="async" /> : name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="video-card-title">{item.title || name}</p>
          <p className="video-card-meta">
            {name}
            <VerifiedBadge tier={item.profile.verificationTier as any} />
            {item.followed && <span className="live-card-followed"> · {t('streamsFollowed')}</span>}
          </p>
          {showCategory && item.category && <span className="live-card-category">{t(item.category as any)}</span>}
        </div>
      </div>
    </Link>
  );
}
