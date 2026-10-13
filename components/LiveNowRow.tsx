'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n';
import { liveElapsed } from '@/lib/liveChat';
import { authHeaders } from '@/lib/authHeaders';
import { announceLiveCount } from '@/lib/useLiveCount';
import VerifiedBadge from './VerifiedBadge';
import ProfileImage from './ProfileImage';

export type LiveItem = {
  ownerId: string;
  title: string;
  category?: string | null;
  startedAt: string | null;
  videoUid: string | null;
  /** Vlastní náhled přenosu (studio / appka); jinak snímek z vysílání. */
  thumbnailUrl?: string | null;
  followed?: boolean;
  /** Kolik lidí se dívá (jen s ?viewers=1, jinak null). */
  viewers?: number | null;
  /**
   * Přenos ostatní nevidí - proč (jen majitel u kontroly obsahu a tým Kine;
   * app/api/live/now): kontrola obsahu, zablokovaný účet, shadow-ban.
   */
  hidden?: 'moderation' | 'banned' | 'shadow-ban' | null;
  profile: { id: string; username: string; displayName: string | null; avatarUrl: string | null; verificationTier: string | null };
};

/** Na hlavní stránce nejvýš tolik přenosů - všechny jsou na stránce Živě (/streams). */
const HOME_LIMIT = 8;

/** Seznam starší než tohle (nejde obnovit) se schová - přenosy v něm už nemusí běžet. */
const STALE_AFTER_MS = 90 * 1000;

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
    // Kdy přišel poslední platný seznam. Starý seznam se neukazuje - jinak tu po návratu
    // do karty (třeba z appky, kde vysílání skončilo) visel přenos, který už neběží.
    let loadedAt = 0;
    async function load() {
      if (document.hidden) return;
      try {
        // S přihlášením: vlastní přenos a odebírané kanály jdou dopředu (lib/liveNow.ts).
        const res = await fetch('/api/live/now', { cache: 'no-store', headers: await authHeaders() });
        const body = await res.json().catch(() => null);
        if (!cancelled && res.ok && body && Array.isArray(body.streams)) {
          loadedAt = Date.now();
          setStreams(body.streams);
          // Číslo u Živě v menu podle téhož seznamu - ať se nerozchází s tím, co je vidět
          // (bez přenosů, které vidí jen majitel a tým Kine - číslo je stejné pro všechny).
          announceLiveCount(typeof body.publicTotal === 'number' ? body.publicTotal : typeof body.total === 'number' ? body.total : body.streams.length);
        }
      } catch {
        // Bez sítě se řada prostě neukáže.
      }
    }
    load();
    const refresh = setInterval(load, 20 * 1000);
    const tick = setInterval(() => {
      setNow(Date.now());
      if (loadedAt && Date.now() - loadedAt > STALE_AFTER_MS) {
        loadedAt = 0;
        setStreams([]);
      }
    }, 1000);
    const onVisible = () => {
      if (document.hidden) return;
      if (loadedAt && Date.now() - loadedAt > 20 * 1000) {
        loadedAt = 0;
        setStreams([]);
      }
      load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
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

/** Karta přenosu: náhled (vlastní, nebo každou minutu nový snímek), LIVE, diváci, jak dlouho běží, kanál. */
export function LiveCard({ item, now, showCategory = false }: { item: LiveItem; now: number; showCategory?: boolean }) {
  const { t } = useLanguage();
  const [thumbFailed, setThumbFailed] = useState(false);
  const [customFailed, setCustomFailed] = useState(false);
  const name = item.profile.displayName || item.profile.username;
  // Vlastní náhled tvůrce; jinak snímek z běžícího přenosu od Cloudflare (každou minutu nový);
  // když nejde ani ten, zůstane avatar na tmavém pozadí.
  const custom = item.thumbnailUrl && !customFailed ? item.thumbnailUrl : null;
  const frame = item.videoUid && !thumbFailed ? `https://videodelivery.net/${item.videoUid}/thumbnails/thumbnail.jpg?height=360&t=${Math.floor(now / 60000)}` : null;
  const thumb = custom ?? frame;
  return (
    <Link href={`/live/${item.ownerId}`} className="live-card" data-anim-scope>
      <div className="live-card-thumb">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" onError={() => (custom ? setCustomFailed(true) : setThumbFailed(true))} />
        ) : (
          <span className="live-card-avatar">{item.profile.avatarUrl ? <ProfileImage src={item.profile.avatarUrl} /> : null}</span>
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
          {item.profile.avatarUrl ? <ProfileImage src={item.profile.avatarUrl} /> : name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ minWidth: 0 }}>
          <p className="video-card-title">{item.title || name}</p>
          <p className="video-card-meta">
            {name}
            <VerifiedBadge tier={item.profile.verificationTier as any} />
            {item.followed && <span className="live-card-followed"> · {t('streamsFollowed')}</span>}
          </p>
          {showCategory && item.category && <span className="live-card-category">{t(item.category as any)}</span>}
          {item.hidden && (
            <span className="live-card-hidden" title={t('liveHiddenWhy')}>
              {item.hidden === 'moderation' ? t('liveHiddenModeration') : item.hidden === 'banned' ? t('liveHiddenBanned') : t('liveHiddenShadowBan')}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
