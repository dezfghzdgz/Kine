'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import StatChartModal from '@/components/StatChartModal';
import RatingChartModal from '@/components/RatingChartModal';
import { computeTrustRatingClient, recordTrustRatingSnapshot, getTotalReactionCount, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';
import FieldHint from '@/components/FieldHint';

type ChartKey = 'subscribers' | 'views' | 'videos' | 'likes' | 'dislikes';

const TIER_LABELS: Record<string, string> = {
  basic: 'Základní',
  silver: 'Stříbrná',
  blue: 'Modrá',
};

const TIER_MULTIPLIER: Record<string, number> = {
  none: 1,
  basic: 1.3,
  silver: 1.6,
  blue: 2,
};

export default function ChannelStatsPage() {
  const { t } = useLanguage();
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
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [ratingsByVideo, setRatingsByVideo] = useState<Record<string, number[]>>({});
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

    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, created_at')
      .eq('owner_id', authData.user.id);

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
      videoIds.forEach((id) => { breakdown[id] = [0, 0, 0, 0, 0]; });
      (allReactions ?? []).forEach((r) => {
        const score = r.score ?? 3;
        if (breakdown[r.video_id] && score >= 1 && score <= 5) {
          breakdown[r.video_id][score - 1]++;
        }
      });
      setRatingsByVideo(breakdown);
    }

    const { data: subs } = await supabase.from('subscriptions').select('created_at').eq('channel_id', authData.user.id);

    const { data: profile } = await supabase.from('profiles').select('verification_tier, created_at').eq('id', authData.user.id).single();
    setVerificationTier(profile?.verification_tier ?? 'none');

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
        <p>Pro zobrazení statistik se musíš nejdřív přihlásit.</p>
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
    views: 'Zhlédnutí v čase',
    videos: t('videosOverTime'),
    likes: 'Lajky v čase',
    dislikes: 'Dislajky v čase',
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
          <FieldHint text="Skládá se ze dvou věcí: jak dlouho appku používáš (starší účet = trochu vyšší základ) a průměrné hodnocení tvých videí. Časem přibudou i další faktory, třeba nahlášení obsahu." />
        </p>
        {reactionCount >= RATING_UNLOCK_THRESHOLD ? (
          <>
            {trustRating !== null && (
              <p style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{trustRating}%</p>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: 0 }}>Klikni pro graf v čase 📈</p>
          </>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
            Rating se odemkne po {RATING_UNLOCK_THRESHOLD} reakcích na tvých videích ({reactionCount}/{RATING_UNLOCK_THRESHOLD})
          </p>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">Ověření tvůrce</p>
        {verificationTier !== 'none' ? (
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            Jsi ověřený tvůrce - úroveň: <strong>{TIER_LABELS[verificationTier]}</strong>.
            Násobič výdělků: <strong>{TIER_MULTIPLIER[verificationTier]}×</strong>
          </p>
        ) : stats.subscriberCount >= 5000 ? (
          requestStatus === 'pending' ? (
            <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
              Tvoje žádost o ověření čeká na posouzení.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
                Splňuješ podmínku 5 000+ odběratelů - můžeš požádat o ověření.
                Ověření tvůrci mají vyšší násobič výdělků.
              </p>
              <button onClick={requestVerification} disabled={requesting}>
                {requesting ? 'Odesílám…' : 'Požádat o ověření'}
              </button>
              {requestStatus === 'rejected' && (
                <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
                  Předchozí žádost byla zamítnuta, ale můžeš to zkusit znovu.
                </p>
              )}
            </>
          )
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>
            Ověření mohou žádat tvůrci s 5 000+ odběrateli (aktuálně máš {stats.subscriberCount}).
            Bez ověření máš násobič výdělků {TIER_MULTIPLIER.none}×, pořád ale vyděláváš.
          </p>
        )}
      </div>

      <div className="panel">
        <div className="tab-row" style={{ marginBottom: 12 }}>
          <button className={`tab-btn ${earningsView === 'chart' ? 'active' : ''}`} onClick={() => setEarningsView('chart')}>
            Výdělky za celou dobu
          </button>
          <button className={`tab-btn ${earningsView === 'payout' ? 'active' : ''}`} onClick={() => setEarningsView('payout')}>
            Další výplata
          </button>
        </div>

        {earningsView === 'chart' ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
            Zatím 0 Kč - sledování výdělků teprve propojíme s platebním systémem.
          </p>
        ) : (
          <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '30px 0' }}>
            Vyplácení zatím není aktivní. Jakmile spustíme platby tvůrcům, uvidíš tu datum a částku další výplaty.
          </p>
        )}
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <p className="panel-heading" style={{ margin: 0 }}>Vaše videa</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Hledat ve videích…"
              value={videoSearch}
              onChange={(e) => setVideoSearch(e.target.value)}
              style={{ fontSize: 13 }}
            />
            <select value={videoSort} onChange={(e) => setVideoSort(e.target.value as 'newest' | 'views')} style={{ fontSize: 13 }}>
              <option value="newest">Nejnovější</option>
              <option value="views">Nejsledovanější</option>
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
            return <p style={{ fontSize: 13, color: 'var(--text-faint)' }}>Žádná videa neodpovídají hledání.</p>;
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {filtered.map((v) => {
                const dist = ratingsByVideo[v.id] ?? [0, 0, 0, 0, 0];
                const maxCount = Math.max(...dist, 1);
                const total = dist.reduce((s, n) => s + n, 0);

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

                    {total > 0 && (
                      <div style={{ paddingLeft: 92, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {[5, 4, 3, 2, 1].map((stars) => {
                          const count = dist[stars - 1];
                          return (
                            <div key={stars} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 20 }}>{stars}★</span>
                              <div style={{ flex: 1, height: 6, background: 'var(--panel-raised)', borderRadius: 999, overflow: 'hidden' }}>
                                <div style={{ width: `${(count / maxCount) * 100}%`, height: '100%', background: 'var(--text)', borderRadius: 999 }} />
                              </div>
                              <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 20, textAlign: 'right' }}>{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
