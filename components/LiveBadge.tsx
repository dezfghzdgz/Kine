'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';

/**
 * "● ŽIVĚ" u kanálu, který právě vysílá (odkaz na stránku přenosu).
 * Když kanál nevysílá nebo živé vysílání není zapnuté, nevykreslí nic.
 */
export default function LiveBadge({ channelId, withTitle = false }: { channelId: string; withTitle?: boolean }) {
  const { t } = useLanguage();
  const [live, setLive] = useState<{ title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/live/status?channel=${encodeURIComponent(channelId)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (!cancelled) setLive(body?.live ? { title: body.stream?.title ?? '' } : null);
      } catch {
        if (!cancelled) setLive(null);
      }
    }
    load();
    const timer = setInterval(load, 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [channelId]);

  if (!live) return null;
  return (
    <Link href={`/live/${channelId}`} className="live-banner">
      <span className="live-pill">● {t('liveBadge')}</span>
      {withTitle && <span className="live-banner-title">{live.title || t('liveNowBanner')}</span>}
      <span className="live-banner-action">{t('liveWatchButton')} →</span>
    </Link>
  );
}
