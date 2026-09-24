'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { channelRoom, liveElapsed } from '@/lib/liveChat';
import { categoryLabel } from '@/lib/categories';
import LiveChat from '@/components/LiveChat';
import SubscribeButton from '@/components/SubscribeButton';
import VerifiedBadge from '@/components/VerifiedBadge';
import ExpandableText from '@/components/ExpandableText';

type Status = {
  enabled: boolean;
  live: boolean;
  profile: { id: string; username: string; display_name: string | null; avatar_url: string | null; verification_tier: string | null } | null;
  stream: {
    title: string;
    description: string;
    category: string | null;
    startedAt: string | null;
    endedAt: string | null;
    playerUrl: string;
    videoUid: string | null;
  } | null;
};

/**
 * Stránka živého přenosu kanálu: přehrávač Cloudflare (s vlastním
 * ovládáním - u živého vysílání umí i počet diváků), název, kanál a chat.
 * Stav se obnovuje každých 15 s: když přenos začne nebo skončí, stránka
 * se přepne sama.
 */
export default function LivePage() {
  const { t, lang } = useLanguage();
  const params = useParams();
  const channelId = params.id as string;
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Adresa přehrávače se drží, dokud přenos běží - změna src by iframe načetla znovu.
  const [playerUrl, setPlayerUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/live/status?channel=${encodeURIComponent(channelId)}`, { cache: 'no-store' });
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !body) {
          setFailed(true);
          return;
        }
        setFailed(false);
        setStatus(body);
        if (body.live && body.stream?.playerUrl) setPlayerUrl((current) => current ?? body.stream.playerUrl);
        if (!body.live) setPlayerUrl(null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    const timer = setInterval(load, 15 * 1000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [channelId]);

  const profile = status?.profile ?? null;
  const name = profile ? profile.display_name || profile.username : '';

  useEffect(() => {
    if (!status) return;
    const title = status.live ? `🔴 ${status.stream?.title || name}` : name;
    if (title) document.title = `${title} - Kine`;
  }, [status, name]);

  if (!status && !failed) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  if (!status || !profile) {
    return (
      <div className="auth-gate">
        <p>{t('liveNotAvailable')}</p>
      </div>
    );
  }
  if (!status.enabled) {
    return (
      <div className="auth-gate">
        <p>{t('liveNotAvailable')}</p>
        <Link href={`/channel/${profile.id}`}>{t('liveGoToChannel')}</Link>
      </div>
    );
  }

  const stream = status.stream;
  const isOwner = viewerId === profile.id;

  const channelRow = (
    <div className="video-meta" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
      <Link href={`/channel/${profile.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="profile-avatar-small" style={{ width: 32, height: 32 }}>
          {profile.avatar_url ? <img loading="lazy" decoding="async" src={profile.avatar_url} alt={name} /> : null}
        </span>
        <span>{name}</span>
        <VerifiedBadge tier={profile.verification_tier as any} />
      </Link>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {isOwner && (
          <Link href="/live" className="live-studio-link">
            {t('liveStudioTitle')}
          </Link>
        )}
        <SubscribeButton channelId={profile.id} />
      </div>
    </div>
  );

  if (!status.live || !playerUrl) {
    return (
      <div className="live-layout">
        <div className="live-main">
          <div className="live-offline panel">
            <p className="live-offline-title">{t('liveOfflineTitle').replace('{name}', name)}</p>
            {stream?.endedAt && (
              <p className="live-offline-note">
                {t('liveOfflineEnded').replace('{time}', new Date(stream.endedAt).toLocaleString(DATE_LOCALES[lang]))}
              </p>
            )}
            <Link href={`/channel/${profile.id}`}>{t('liveGoToChannel')} →</Link>
          </div>
          {channelRow}
        </div>
        <LiveChat room={channelRoom(profile.id)} canModerate={isOwner} className="live-side" />
      </div>
    );
  }

  return (
    <div className="live-layout">
      <div className="live-main">
        <div className="player-wrap live-player" style={{ aspectRatio: '16/9' }}>
          <iframe
            src={playerUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
            allowFullScreen
            title={stream?.title || name}
          />
        </div>
        <h1 className="video-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="live-pill">● {t('liveBadge')}</span>
          {stream?.title || name}
        </h1>
        <p className="live-meta">
          {stream?.startedAt && <span>{liveElapsed(stream.startedAt, now)}</span>}
          {stream?.category && <span> · {categoryLabel(stream.category, t)}</span>}
        </p>
        {channelRow}
        {stream?.description && (
          <div className="panel" style={{ marginTop: 14 }}>
            <ExpandableText text={stream.description} />
          </div>
        )}
      </div>
      <LiveChat room={channelRoom(profile.id)} canModerate={isOwner} className="live-side" />
    </div>
  );
}
