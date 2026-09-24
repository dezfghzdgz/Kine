'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { liveElapsed } from '@/lib/liveChat';
import VerifiedBadge from './VerifiedBadge';

type LiveItem = {
  ownerId: string;
  title: string;
  startedAt: string | null;
  videoUid: string | null;
  profile: { id: string; username: string; displayName: string | null; avatarUrl: string | null; verificationTier: string | null };
};

/**
 * Řada "Živě" na hlavní stránce - kdo teď vysílá. Když nikdo, nevykreslí
 * se nic. Obnovuje se jednou za minutu.
 */
export default function LiveNowRow() {
  const { t } = useLanguage();
  const [streams, setStreams] = useState<LiveItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/live/now', { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!cancelled && body && Array.isArray(body.streams)) setStreams(body.streams);
      } catch {
        // Bez sítě se řada prostě neukáže.
      }
    }
    load();
    const refresh = setInterval(load, 60 * 1000);
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
      <p className="section-title">
        <span className="live-dot" aria-hidden="true" /> {t('liveNowHeading')}
      </p>
      <div className="live-now-grid">
        {streams.map((s) => (
          <LiveCard key={s.ownerId} item={s} now={now} />
        ))}
      </div>
    </section>
  );
}

function LiveCard({ item, now }: { item: LiveItem; now: number }) {
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
        {item.startedAt && <span className="live-card-elapsed">{liveElapsed(item.startedAt, now)}</span>}
      </div>
      <p className="video-card-title">{item.title || name}</p>
      <p className="video-card-meta">
        {name}
        <VerifiedBadge tier={item.profile.verificationTier as any} />
      </p>
    </Link>
  );
}
