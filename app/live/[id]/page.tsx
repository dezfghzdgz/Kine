'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import { authHeaders } from '@/lib/authHeaders';
import { channelRoom, liveElapsed } from '@/lib/liveChat';
import { categoryLabel } from '@/lib/categories';
import LiveChat from '@/components/LiveChat';
import LiveTipDialog from '@/components/LiveTipDialog';
import SubscribeButton from '@/components/SubscribeButton';
import VerifiedBadge from '@/components/VerifiedBadge';
import ExpandableText from '@/components/ExpandableText';
import { FOLLOW_LIVE_MS, liveFrameUrl, preloadImage, setAmbientSource } from '@/lib/appearance';
import AmbientCanvas from '@/components/AmbientCanvas';
import { useAppearance } from '@/lib/useAppearance';

type Status = {
  enabled: boolean;
  live: boolean;
  /** Přenos skrytý automatickou kontrolou obsahu - divák místo přehrávače vidí "čeká na kontrolu". */
  held?: boolean;
  /** Jen majitel a moderátoři: přenos je skrytý kontrolou obsahu (přehrávač vidí s upozorněním). */
  moderation?: { hidden: boolean };
  /** Podpory ve vysílání (tlačítko 💛): kanál je umí přijmout. */
  tips?: { enabled: boolean; feePercent: number };
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
 * Stav se obnovuje každých 6 s: když přenos začne nebo skončí, stránka
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
  const [tipOpen, setTipOpen] = useState(false);
  // Návrat z platby Stripe (?tip=thanks / ?tip=cancel).
  const [tipNotice, setTipNotice] = useState<'thanks' | 'cancel' | null>(null);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('tip');
    if (result === 'thanks' || result === 'cancel') {
      setTipNotice(result);
      window.history.replaceState(null, '', window.location.pathname);
      const timer = setTimeout(() => setTipNotice(null), 9000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setViewerId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/live/status?channel=${encodeURIComponent(channelId)}`, { cache: 'no-store', headers: await authHeaders() });
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
    const timer = setInterval(load, 6 * 1000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [channelId]);

  const profile = status?.profile ?? null;
  const name = profile ? profile.display_name || profile.username : '';

  // Skleněný vzhled "podle videa" a světlo kolem přehrávače: snímek z přenosu (jinak avatar kanálu).
  // "Sleduje obraz" (Nastavení -> Vzhled): snímek z přenosu každé 2 s, barvy se plynule přelévají (AmbientCanvas).
  const appearance = useAppearance();
  const liveUid = status?.live ? status.stream?.videoUid ?? null : null;
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const followLive = appearance.follow && !!liveUid;
  useEffect(() => {
    setLiveFrame(null);
    if (!followLive || !liveUid) return;
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const url = liveFrameUrl(liveUid, Date.now());
      if ((await preloadImage(url)) && !cancelled) setLiveFrame(url);
    };
    void tick();
    const timer = setInterval(() => void tick(), FOLLOW_LIVE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [followLive, liveUid]);
  const liveStill = liveUid ? `https://videodelivery.net/${encodeURIComponent(liveUid)}/thumbnails/thumbnail.jpg?height=270` : null;
  const ambientThumb = liveFrame ?? liveStill ?? profile?.avatar_url ?? null;
  useEffect(() => {
    setAmbientSource(ambientThumb);
  }, [ambientThumb]);
  useEffect(() => () => setAmbientSource(null), []);

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
        {!isOwner && status.live && status.tips?.enabled && (
          <button type="button" className="live-tip-btn" onClick={() => setTipOpen(true)}>
            💛 {t('tipButton')}
          </button>
        )}
        <SubscribeButton channelId={profile.id} />
      </div>
      {tipOpen && (
        <LiveTipDialog
          channelId={profile.id}
          channelName={name}
          feePercent={status.tips?.feePercent ?? 15}
          loggedIn={!!viewerId}
          onClose={() => setTipOpen(false)}
        />
      )}
    </div>
  );

  if (status.live && status.held) {
    return (
      <div className="live-layout">
        <div className="live-main">
          <div className="live-held" role="status">
            <div>
              <p style={{ fontSize: 28, margin: 0 }} aria-hidden="true">
                ⏸
              </p>
              <p style={{ fontWeight: 700, color: 'var(--text)', fontSize: 'var(--fs-lg)' }}>{t('liveHeldTitle')}</p>
              <p>{t('liveHeldText')}</p>
            </div>
          </div>
          {channelRow}
        </div>
        <LiveChat room={channelRoom(profile.id)} canModerate={isOwner} className="live-side" popoutHref={`/live/${profile.id}/chat`} />
      </div>
    );
  }

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
        <LiveChat room={channelRoom(profile.id)} canModerate={isOwner} className="live-side" popoutHref={`/live/${profile.id}/chat`} />
      </div>
    );
  }

  return (
    <div className="live-layout">
      <div className="live-main">
        {status.moderation?.hidden && (
          <div className="moderation-hold-note" role="status">
            <span aria-hidden="true">⚠️</span>
            <span>{t('liveHeldOwner')}</span>
          </div>
        )}
        {tipNotice && (
          <div className={`tip-notice ${tipNotice}`} role="status">
            {tipNotice === 'thanks' ? `💛 ${t('tipThanks')}` : t('tipCancelled')}
          </div>
        )}
        <div className="live-player-ambient-host" style={{ position: 'relative' }}>
          <div className="player-wrap live-player" style={{ aspectRatio: '16/9' }}>
            <iframe
              src={playerUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
              allowFullScreen
              title={stream?.title || name}
            />
          </div>
          {liveUid && (
            <div className="player-ambient" aria-hidden="true">
              <AmbientCanvas src={liveFrame ?? liveStill} />
            </div>
          )}
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
      <LiveChat room={channelRoom(profile.id)} canModerate={isOwner} className="live-side" popoutHref={`/live/${profile.id}/chat`} />
    </div>
  );
}
