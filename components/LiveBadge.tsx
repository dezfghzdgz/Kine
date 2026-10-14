'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';

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
        // S přihlášením: majitel shadow-banovaného kanálu svůj přenos vidí (ostatní ne).
        const res = await fetch(`/api/live/status?channel=${encodeURIComponent(channelId)}`, { cache: 'no-store', headers: await authHeaders() });
        const body = await res.json().catch(() => null);
        if (!cancelled) setLive(body?.live ? { title: body.stream?.title ?? '' } : null);
      } catch {
        if (!cancelled) setLive(null);
      }
    }
    load();
    // Jen když je karta vidět (stav přenosu se ptá Cloudflare); po návratu hned.
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 30 * 1000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
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
