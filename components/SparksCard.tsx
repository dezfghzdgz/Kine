'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { supabase } from '@/lib/supabaseClient';
import { ThumbsUpIcon, ThumbsDownIcon } from './ReactionIcons';
import { shouldNotifyLikeMilestone } from '@/lib/likeMilestones';
import { useLanguage } from '@/lib/i18n';

export default function SparksCard({
  video, active, commentsOpen, onToggleComments,
}: {
  video: any;
  active: boolean;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [ratingMode, setRatingMode] = useState<'stars' | 'like_dislike'>('like_dislike');
  const [myScore, setMyScore] = useState<number | null>(null);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [totalRatings, setTotalRatings] = useState(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    load();
  }, [video.id]);

  // Spoléhat jen na "muted=false" v adrese videa nestačí - prohlížeče
  // často tiché přehrávání se zvukem stejně zablokují. Místo toho appka
  // aktivně "chytí" přehrávač a zvuk mu zapne sama, jakmile je video aktivní.
  useEffect(() => {
    if (!active) {
      playerRef.current = null;
      return;
    }

    setPaused(false);
    setMuted(false);

    const interval = setInterval(() => {
      if (iframeRef.current && (window as any).Stream && !playerRef.current) {
        playerRef.current = (window as any).Stream(iframeRef.current);
        playerRef.current.muted = false;
        playerRef.current.volume = 1;
        playerRef.current.play?.();
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [active, video.id]);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);

    if (authData.user) {
      const { data: profile } = await supabase.from('profiles').select('rating_mode').eq('id', authData.user.id).single();
      setRatingMode((profile?.rating_mode as 'stars' | 'like_dislike') ?? 'like_dislike');

      if (video.profiles?.id) {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('subscriber_id')
          .eq('subscriber_id', authData.user.id)
          .eq('channel_id', video.profiles.id)
          .maybeSingle();
        setSubscribed(!!sub);
      }
    }

    const { data: reactions } = await supabase.from('video_reactions').select('score, user_id').eq('video_id', video.id);
    if (reactions && reactions.length > 0) {
      setAvgScore(reactions.reduce((s, r) => s + (r.score ?? 3), 0) / reactions.length);
      setTotalRatings(reactions.length);
      const mine = reactions.find((r) => r.user_id === authData.user?.id);
      setMyScore(mine?.score ?? null);
    }

    const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('video_id', video.id);
    setCommentCount(count ?? 0);
  }

  async function submitScore(score: number) {
    if (!userId) { router.push('/login'); return; }
    if (myScore === score) {
      await supabase.from('video_reactions').delete().eq('video_id', video.id).eq('user_id', userId);
    } else {
      const wasAlreadyLike = myScore !== null && myScore >= 4;
      await supabase.from('video_reactions').upsert({
        video_id: video.id, user_id: userId, score,
        reaction: score >= 4 ? 'like' : score <= 2 ? 'dislike' : null,
      });

      if (score >= 4 && !wasAlreadyLike && video.profiles?.id && video.profiles.id !== userId) {
        const { count } = await supabase
          .from('video_reactions')
          .select('*', { count: 'exact', head: true })
          .eq('video_id', video.id)
          .gte('score', 4);

        if (count && shouldNotifyLikeMilestone(count)) {
          await supabase.from('notifications').insert({
            user_id: video.profiles.id,
            message: `Tvoje video dosáhlo ${count} ${count === 1 ? 'lajku' : 'lajků'}!`,
            link: `/watch/${video.id}`,
          });
        }
      }
    }
    load();
  }

  async function toggleSubscribe() {
    if (!userId || !video.profiles?.id) { router.push('/login'); return; }
    if (subscribed) {
      await supabase.from('subscriptions').delete().eq('subscriber_id', userId).eq('channel_id', video.profiles.id);
    } else {
      await supabase.from('subscriptions').insert({ subscriber_id: userId, channel_id: video.profiles.id });
    }
    setSubscribed(!subscribed);
  }

  async function handleShare() {
    await navigator.clipboard.writeText(`${window.location.origin}/watch/${video.id}`);
    flash(t('linkCopied'));
  }

  function flash(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2000);
  }

  function togglePlayPause() {
    if (!playerRef.current) return;
    if (playerRef.current.paused) {
      playerRef.current.play();
      setPaused(false);
    } else {
      playerRef.current.pause();
      setPaused(true);
    }
  }

  function toggleMute() {
    if (!playerRef.current) return;
    const next = !playerRef.current.muted;
    playerRef.current.muted = next;
    setMuted(next);
  }

  const creatorName = video.profiles?.display_name ?? video.profiles?.username ?? 'neznámý tvůrce';

  return (
    <div className="spark-slide">
      <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" strategy="lazyOnload" />
      <div className="spark-player-wrap" onClick={togglePlayPause} style={{ cursor: 'pointer', position: 'relative' }}>
        {active ? (
          <iframe
            ref={iframeRef}
            src={`https://iframe.videodelivery.net/${video.cloudflare_video_id}?autoplay=true&muted=false&loop=true&controls=false`}
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: '#0a0a0b' }} />
        )}
        {active && paused && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 44, color: '#fff' }}>▶</span>
          </div>
        )}
        {active && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleMute(); }}
            style={{
              position: 'absolute', top: 14, right: 14, background: 'rgba(0,0,0,0.5)', border: 'none',
              color: '#fff', width: 32, height: 32, borderRadius: '50%', fontSize: 14, cursor: 'pointer',
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        )}
      </div>

      {toastMsg && <div className="spark-toast">{toastMsg}</div>}

      <div className="spark-info">
        <Link href={`/channel/${video.profiles?.id}`} style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
          @{video.profiles?.username ?? 'uzivatel'}
        </Link>
        <p style={{ color: '#fff', fontSize: 13, margin: '4px 0 0', opacity: 0.9 }}>{video.title}</p>
      </div>

      <div className="spark-actions">
        {ratingMode === 'stars' ? (
          <div className="spark-action-item">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[5, 4, 3, 2, 1].map((n) => (
                <span
                  key={n}
                  onClick={() => submitScore(n)}
                  style={{
                    fontSize: 20, cursor: 'pointer', color: (myScore ?? 0) >= n ? '#fff' : 'rgba(255,255,255,0.4)',
                    padding: '3px 6px', lineHeight: 1, display: 'inline-block',
                  }}
                >
                  ★
                </span>
              ))}
            </div>
            <span className="spark-action-label">{avgScore ? avgScore.toFixed(1) : '—'}</span>
          </div>
        ) : (
          <>
            <div className="spark-action-item" onClick={() => submitScore(5)}>
              <ThumbsUpIcon filled={myScore === 5} size={28} />
              <span className="spark-action-label">{totalRatings > 0 ? totalRatings : ''}</span>
            </div>
            <div className="spark-action-item" onClick={() => submitScore(1)}>
              <ThumbsDownIcon filled={myScore === 1} size={28} />
            </div>
          </>
        )}

        <div className="spark-action-item" onClick={onToggleComments}>
          <span style={{ fontSize: 24, color: commentsOpen ? '#fff' : 'rgba(255,255,255,0.85)' }}>💬</span>
          <span className="spark-action-label">{commentCount}</span>
        </div>

        <div className="spark-action-item" onClick={handleShare}>
          <span style={{ fontSize: 24 }}>🔗</span>
          <span className="spark-action-label">{t('share')}</span>
        </div>

        {video.profiles?.id && userId !== video.profiles?.id && (
          <div className="spark-action-item" onClick={toggleSubscribe}>
            <span
              style={{
                width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', background: subscribed ? 'rgba(255,255,255,0.3)' : '#fff',
                color: subscribed ? '#fff' : '#0a0a0b', fontSize: 15, fontWeight: 700,
              }}
            >
              {subscribed ? '✓' : '+'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
