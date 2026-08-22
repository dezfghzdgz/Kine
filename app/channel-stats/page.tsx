'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import StatChartModal from '@/components/StatChartModal';
import RatingChartModal from '@/components/RatingChartModal';
import StarDistribution from '@/components/StarDistribution';
import { computeTrustRatingClient, recordTrustRatingSnapshot, getTotalReactionCount, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';
import FieldHint from '@/components/FieldHint';

type ChartKey = 'subscribers' | 'views' | 'videos' | 'likes' | 'dislikes';

const TIER_MULTIPLIER: Record<string, number> = {
  none: 1,
  basic: 1.3,
  silver: 1.6,
  blue: 2,
};

export default function ChannelStatsPage() {
  const { t } = useLanguage();
  const TIER_LABELS: Record<string, string> = {
    basic: t('tierBasic'),
    silver: t('tierSilver'),
    blue: t('tierBlue'),
  };
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    videoCount: 0,
    totalViews: 0,
    totalLikes: 0,
    totalDislikes: 0,
    subscriberCount: 0,
    avgRating: null as number | null,
  });
  const [topVideo, setTopVideo] = useState<any>(null);
  const [totalComments, setTotalComments] = useState(0);
  const [allVideos, setAllVideos] = useState<any[]>([]);
  const [videoSearch, setVideoSearch] = useState('');
  const [videoSort, setVideoSort] = useState<'newest' | 'views'>('newest');
  const [timestamps, setTimestamps] = useState<Record<ChartKey, Date[]>>({
    subscribers: [], views: [], videos: [], likes: [], dislikes: [],
  });
  const [openChart, setOpenChart] = useState<ChartKey | null>(null);
  const [ratingChartOpen, setRatingChartOpen] = useState(false);
  const [earningsView, setEarningsView] = useState<'chart' | 'payout'>('chart');
  const [verificationTier, setVerificationTier] = useState<string>('none');
  const [payoutsSuspended, setPayoutsSuspended] = useState(false);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [ratingsByVideo, setRatingsByVideo] = useState<Record<string, number[]>>({});
  // Součet za celý kanál: kolikrát padla 1★, 2★, ... 5★ (index 0 = 1★)
  const [ratingTotals, setRatingTotals] = useState<number[]>([0, 0, 0, 0, 0]);
  const [trustRating, setTrustRating] = useState<number | null>(null);
  const [trustHistory, setTrustHistory] = useState<{ date: string; score: number }[]>([]);
  const [reactionCount, setReactionCount] = useState(0);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setChecking(false);
      return;
    }
    setUserId(authData.user.id);

    const [{ data: ownVideos }, { data: collabRows }] = await Promise.all([
      supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, created_at')
        .eq('owner_id', authData.user.id),
      supabase
        .from('video_collaborators')
        .select('status, videos(id, title, thumbnail_url, views, created_at)')
        .eq('profile_id', authData.user.id),
    ]);

    const collabVideos = (collabRows ?? [])
      .filter((r: any) => r.status === 'accepted')
      .map((r: any) => r.videos)
      .filter(Boolean);

    const videos = [...(ownVideos ?? []), ...collabVideos].filter(
      (v, i, arr) => arr.findIndex((x: any) => x.id === v.id) === i
    );

    const videoIds = (videos ?? []).map((v) => v.id);
    const totalViews = (videos ?? []).reduce((sum, v) => sum + (v.views ?? 0), 0);
    const sortedByViews = [...(videos ?? [])].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

    let totalLikes = 0;
    let totalDislikes = 0;
    let likeTimestamps: Date[] = [];
    let dislikeTimestamps: Date[] = [];
    let viewTimestamps: Date[] = [];
    let avgRating: number | null = null;

    if (videoIds.length > 0) {
      const { data: reactions } = await supabase
        .from('video_reactions')
        .select('reaction, score, created_at')
        .in('video_id', videoIds);

      totalLikes = (reactions ?? []).filter((r) => r.reaction === 'like').length;
      totalDislikes = (reactions ?? []).filter((r) => r.reaction === 'dislike').length;
      likeTimestamps = (reactions ?? []).filter((r) => r.reaction === 'like').map((r) => new Date(r.created_at));
      dislikeTimestamps = (reactions ?? []).filter((r) => r.reaction === 'dislike').map((r) => new Date(r.created_at));

      if (reactions && reactions.length > 0) {
        avgRating = reactions.reduce((sum, r) => sum + (r.score ?? 3), 0) / reactions.length;
      }

      const { data: viewsLog } = await supabase.from('views_log').select('viewed_at').in('video_id', videoIds);
      viewTimestamps = (viewsLog ?? []).map((v) => new Date(v.viewed_at));

      const { count: commentCount } = await supabase
        .from('comments')
        .select('*', { count: 'exact', head: true })
        .in('video_id', videoIds);
      setTotalComments(commentCount ?? 0);

      const { data: allReactions } = await supabase
        .from('video_reactions')
        .select('video_id, score')
        .in('video_id', videoIds);

      const breakdown: Record<string, number[]> = {};
      const totals = [0, 0, 0, 0, 0];
      videoIds.forEach((id) => { breakdown[id] = [0, 0, 0, 0, 0]; });
      (allReactions ?? []).forEach((r) => {
        const score = r.score ?? 3;
        if (breakdown[r.video_id] && score >= 1 && score <= 5) {
          breakdown[r.video_id][score - 1]++;
          totals[score - 1]++;
        }
      });
      setRatingsByVideo(breakdown);
      setRatingTotals(totals);
    }

    const { data: subs } = await supabase.from('subscriptions').select('created_at').eq('channel_id', authData.user.id);

    const { data: profile } = await supabase.from('profiles').select('verification_tier, created_at, payouts_suspended').eq('id', authData.user.id).single();
    setVerificationTier(profile?.verification_tier ?? 'none');
    setPayoutsSuspended(!!profile?.payouts_suspended);

    if (profile?.created_at) {
      const score = await computeTrustRatingClient(authData.user.id, profile.created_at);
      setTrustRating(score);
      await recordTrustRatingSnapshot(authData.user.id, score);
      setReactionCount(await getTotalReactionCount(authData.user.id));

      const { data: history } = await supabase
        .from('trust_rating_snapshots')
        .select('recorded_date, score')
        .eq('profile_id', authData.user.id)
        .order('recorded_date', { ascending: true })
        .limit(90);
      setTrustHistory((history ?? []).map((h) => ({ date: h.recorded_date, score: h.score })));
    }

    const { data: lastRequest } = await supabase
      .from('verification_requests')
      .select('status')
      .eq('user_id', authData.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setRequestStatus(lastRequest?.status ?? null);

    setTimestamps({
      subscribers: (subs ?? []).map((s) => new Date(s.created_at)),
      views: viewTimestamps,
      videos: (videos ?? []).map((v) => new Date(v.created_at)),
      likes: likeTimestamps,
      dislikes: dislikeTimestamps,
    });

    setStats({
      videoCount: videos?.length ?? 0,
      totalViews,
      totalLikes,
      totalDislikes,
      subscriberCount: subs?.length ?? 0,
      avgRating,
    });
    setTopVideo(sortedByViews[0] ?? null);
    setAllVideos(videos ?? []);
    setChecking(false);
  }

  async function requestVerification() {
    setRequesting(true);
    await supabase.from('verification_requests').insert({
      user_id: userId,
      subscriber_count_at_request: stats.subscriberCount,
    });
    setRequestStatus('pending');
    setRequesting(false);
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>{t('loginToViewStatsNote')}</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  const cards: { key: ChartKey; label: string; value: string | number; icon: string }[] = [
    { key: 'subscribers', label: t('subscribersLabel'), value: stats.subscriberCount, icon: '👥' },
    { key: 'views', label: t('totalViewsLabel'), value: stats.totalViews, icon: '👁' },
    { key: 'videos', label: t('videoCountLabel'), value: stats.videoCount, icon: '🎬' },
    { key: 'likes', label: t('likesLabel'), value: stats.totalLikes, icon: '👍' },
    { key: 'dislikes', label: t('dislikesLabel'), value: stats.totalDislikes, icon: '👎' },
  ];

  const chartTitles: Record<ChartKey, string> = {
    subscribers: t('subscribersOverTime'),
    views: t('viewsOverTimeChartTitle'),
    videos: t('videosOverTime'),
    likes: t('likesOverTime'),
    dislikes: t('dislikesOverTime'),
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <p className="section-title">{t('channelStatsTitle')}</p>

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 12, marginBottom: 20,
        }}
      >
        {cards.map((card) => {
          const valueStr = String(card.value);
          const valueFontSize = valueStr.length > 9 ? 14 : valueStr.length > 6 ? 17 : 22;

          return (
            <div
              key={card.key}
              onClick={() => setOpenChart(card.key)}
              className="panel"
              style={{
                cursor: 'pointer', textAlign: 'center', padding: '18px 12px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                minHeight: 108, marginTop: 0,
              }}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{card.icon}</div>
              <div style={{ fontSize: valueFontSize, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {card.value}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>{card.label} 📈</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <div className="panel">
          <p className="panel-heading">{t('topVideoLabel')}</p>
          {topVideo ? (
            <Link href={`/watch/${topVideo.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 64, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--panel-raised)' }}>
                {topVideo.thumbnail_url && (
                  <Image src={topVideo.thumbnail_url} alt={topVideo.title} width={64} height={36} style={{ objectFit: 'cover' }} />
                )}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{topVideo.title}</p>
                <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{topVideo.views} {t('views')}</p>
              </div>
            </Link>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>{t('noVideosYetShort')}</p>
          )}
        </div>

        <div className="panel">
          <p className="panel-heading">{t('avgRatingLabel')}</p>
          {stats.avgRating !== null ? (
            <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
              {stats.avgRating.toFixed(1)} <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>/ 5</span>
            </p>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>{t('noRatingsYet')}</p>
          )}
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <p className="panel-heading">Rozložení hvězdiček (celý kanál)</p>
          <StarDistribution distribution={ratingTotals} />
        </div>

        <div className="panel">
          <p className="panel-heading">{t('totalCommentsLabel')}</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{totalComments}</p>
        </div>

        <div className="panel">
          <p className="panel-heading">{t('engagementRateLabel')}</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
            {stats.totalViews > 0
              ? `${(((stats.totalLikes + stats.totalDislikes + totalComments) / stats.totalViews) * 100).toFixed(1)}%`
              : '—'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 0 0' }}>
            {t('engagementRateDesc')}
          </p>
        </div>
      </div>

      <div
        className="panel"
        style={{ marginBottom: 20, cursor: reactionCount >= RATING_UNLOCK_THRESHOLD ? 'pointer' : 'default' }}
        onClick={() => { if (reactionCount >= RATING_UNLOCK_THRESHOLD) setRatingChartOpen(true); }}
      >
        <p className="panel-heading">
          Rating
          <FieldHint text={t('ratingExplanationHint')} />
        </p>
        {reactionCount >= RATING_UNLOCK_THRESHOLD ? (
          <>
            {trustRating !== null && (
              <p style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{trustRating}%</p>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>{t('clickForChartOverTime')}</p>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
            {t('ratingUnlocksAfterPrefix')} {RATING_UNLOCK_THRESHOLD} {t('ratingUnlocksAfterSuffix')} ({reactionCount}/{RATING_UNLOCK_THRESHOLD})
          </p>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">{t('verificationTierTitle')}</p>
        {verificationTier !== 'none' ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {t('verifiedCreatorIntro')} <strong>{TIER_LABELS[verificationTier]}</strong>.
            {' '}{t('earningsMultiplierLabel')} <strong>{TIER_MULTIPLIER[verificationTier]}×</strong>
          </p>
        ) : stats.subscriberCount >= 5000 ? (
          requestStatus === 'pending' ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              {t('verificationPendingNotice')}
            </p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
                {t('meetsVerificationCondition')}
              </p>
              <button onClick={requestVerification} disabled={requesting}>
                {requesting ? t('sendingLabel') : t('requestVerificationButton')}
              </button>
              {requestStatus === 'rejected' && (
                <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
                  {t('previousRequestRejectedNotice')}
                </p>
              )}
            </>
          )
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            {t('verificationEligibilityNote')} ({t('currentlyHaveLabel')} {stats.subscriberCount}).
            {' '}{t('noVerificationMultiplierNote')} {TIER_MULTIPLIER.none}×, {t('stillEarningNote')}
          </p>
        )}
      </div>

      <div className="panel">
        {payoutsSuspended && (
          <p style={{ color: '#ff6b6b', fontSize: 12.5, marginBottom: 10 }}>
            ⚠️ {t('payoutsSuspendedNote')}
          </p>
        )}
        <div className="tab-row" style={{ marginBottom: 12 }}>
          <button className={`tab-btn ${earningsView === 'chart' ? 'active' : ''}`} onClick={() => setEarningsView('chart')}>
            {t('earningsAllTimeTab')}
          </button>
          <button className={`tab-btn ${earningsView === 'payout' ? 'active' : ''}`} onClick={() => setEarningsView('payout')}>
            {t('nextPayoutTab')}
          </button>
        </div>

        {earningsView === 'chart' ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
            {t('earningsPlaceholderNote')}
          </p>
        ) : (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
            {t('payoutNotActiveNote')}
          </p>
        )}
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <p className="panel-heading" style={{ margin: 0 }}>{t('yourVideosHeading')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder={t('searchVideosPlaceholder')}
              value={videoSearch}
              onChange={(e) => setVideoSearch(e.target.value)}
              style={{ fontSize: 13 }}
            />
            <select value={videoSort} onChange={(e) => setVideoSort(e.target.value as 'newest' | 'views')} style={{ fontSize: 13 }}>
              <option value="newest">{t('sortNewest')}</option>
              <option value="views">{t('sortMostViewed')}</option>
            </select>
          </div>
        </div>

        {(() => {
          const filtered = allVideos
            .filter((v) => v.title.toLowerCase().includes(videoSearch.toLowerCase()))
            .sort((a, b) =>
              videoSort === 'views'
                ? (b.views ?? 0) - (a.views ?? 0)
                : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );

          if (filtered.length === 0) {
            return <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>{t('noVideosMatchSearch')}</p>;
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {filtered.map((v) => {
                const dist = ratingsByVideo[v.id] ?? [0, 0, 0, 0, 0];

                return (
                  <div key={v.id} style={{ paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    <Link href={`/watch/${v.id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ width: 80, height: 45, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--panel-raised)' }}>
                        {v.thumbnail_url && (
                          <Image src={v.thumbnail_url} alt={v.title} width={80} height={45} style={{ objectFit: 'cover' }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.title}
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>
                          {new Date(v.created_at).toLocaleDateString('cs-CZ')}
                        </p>
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-dim)', flexShrink: 0 }}>{v.views} {t('views')}</span>
                    </Link>

                    <div style={{ paddingLeft: 92 }}>
                      <StarDistribution distribution={dist} compact />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {ratingChartOpen && (
        <RatingChartModal history={trustHistory} onClose={() => setRatingChartOpen(false)} />
      )}

      {openChart && (
        <StatChartModal
          title={chartTitles[openChart]}
          timestamps={timestamps[openChart]}
          onClose={() => setOpenChart(null)}
        />
      )}
    </div>
  );
}
