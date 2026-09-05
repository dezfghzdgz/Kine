'use client';

import { useEffect, useState } from 'react';
import { useLanguage, DATE_LOCALES } from '@/lib/i18n';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { fetchAllRows } from '@/lib/loadAll';
import StatChartModal from '@/components/StatChartModal';
import RatingChartModal from '@/components/RatingChartModal';
import StarDistribution from '@/components/StarDistribution';
import StatsBarList, { type BarItem } from '@/components/StatsBarList';
import StatsHeatmap from '@/components/StatsHeatmap';
import StatsVideoTable, { formatWatchTime, type VideoStatsRow } from '@/components/StatsVideoTable';
import { viewSourceLabelKey } from '@/lib/viewSource';
import {
  effectiveCreatorPercent, nextTierFor, PARTNER_STATUS_LABELS, type PartnerStatus,
} from '@/lib/revenueShare';
import { computeTrustRatingClient, recordTrustRatingSnapshot, getTotalReactionCount, RATING_UNLOCK_THRESHOLD } from '@/lib/trustRatingClient';
import FieldHint from '@/components/FieldHint';

/** Prázdná mřížka 7 dní x 24 hodin pro graf "kdy se lidi dívají". */
function emptyHeatmap(): number[][] {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

type ViewLogRow = { viewed_at: string; source?: string | null; video_id?: string };

const VIEWS_PAGE_SIZE = 1000;

/**
 * Natáhne VŠECHNA zhlédnutí daných videí, po stránkách.
 *
 * Supabase na jeden dotaz vrátí nanejvýš tisíc řádků. Bez stránkování by se
 * grafy "odkud diváci přicházejí" a "kdy se lidi dívají" po překročení téhle
 * hranice počítaly z náhodného výřezu dat a tvářily se, že jsou kompletní.
 *
 * Sloupec "source" přidává samostatná migrace - dokud neproběhne, appka si
 * vezme aspoň časy zhlédnutí, ať se kvůli tomu nerozbije celá stránka.
 */
async function loadAllViews(videoIds: string[]): Promise<ViewLogRow[]> {
  const rows: ViewLogRow[] = [];
  let columns = 'viewed_at, source, video_id';

  for (let page = 0; ; page++) {
    const from = page * VIEWS_PAGE_SIZE;
    const { data, error } = await supabase
      .from('views_log')
      .select(columns)
      .in('video_id', videoIds)
      .order('viewed_at', { ascending: true })
      .range(from, from + VIEWS_PAGE_SIZE - 1);

    if (error) {
      if (columns.includes('source')) {
        // Migrace zatím neproběhla - zkusíme to znovu bez zdroje, od začátku.
        columns = 'viewed_at, video_id';
        rows.length = 0;
        page = -1;
        continue;
      }
      break;
    }

    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < VIEWS_PAGE_SIZE) break;
  }

  return rows;
}

type ChartKey = 'subscribers' | 'views' | 'videos' | 'likes' | 'dislikes';

const TIER_MULTIPLIER: Record<string, number> = {
  none: 1,
  basic: 1.3,
  silver: 1.6,
  blue: 2,
};

export default function ChannelStatsPage() {
  const { t, lang } = useLanguage();
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
  // Ukládá se klíč, ne hotový text - překlad se udělá až při vykreslení,
  // jinak by popisky zamrzly v jazyce, který platil při načtení stránky.
  const [viewSources, setViewSources] = useState<{ key: string; labelKey: string | null; value: number }[]>([]);
  const [watchHeatmap, setWatchHeatmap] = useState<number[][]>(emptyHeatmap);
  const [videoTable, setVideoTable] = useState<VideoStatsRow[]>([]);
  const [watchStats, setWatchStats] = useState({
    totalWatchSeconds: 0,
    avgCompletionPercent: null as number | null,
    finishedShare: null as number | null,
    uniqueViewers: 0,
  });
  const [watchStatsAvailable, setWatchStatsAvailable] = useState(true);
  const [revenueShare, setRevenueShare] = useState<{
    percent: number | null;
    status: PartnerStatus;
    note: string | null;
    manual: boolean;
  }>({ percent: null, status: 'standard', note: null, manual: false });
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
        .select('id, title, thumbnail_url, views, created_at, duration_seconds')
        .eq('owner_id', authData.user.id),
      supabase
        .from('video_collaborators')
        .select('status, videos(id, title, thumbnail_url, views, created_at, duration_seconds)')
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
      // Jeden dotaz na reakce pro celou stránku - dřív se ta samá tabulka
      // tahala dvakrát za sebou.
      const { data: reactions } = await supabase
        .from('video_reactions')
        .select('video_id, reaction, score, created_at')
        .in('video_id', videoIds);

      totalLikes = (reactions ?? []).filter((r) => r.reaction === 'like').length;
      totalDislikes = (reactions ?? []).filter((r) => r.reaction === 'dislike').length;
      likeTimestamps = (reactions ?? []).filter((r) => r.reaction === 'like').map((r) => new Date(r.created_at));
      dislikeTimestamps = (reactions ?? []).filter((r) => r.reaction === 'dislike').map((r) => new Date(r.created_at));

      if (reactions && reactions.length > 0) {
        avgRating = reactions.reduce((sum, r) => sum + (r.score ?? 3), 0) / reactions.length;
      }

      // Zdroj zhlédnutí přidává samostatná migrace. Když ještě neproběhla,
      // dotaz se sloupcem "source" skončí chybou - v tom případě si appka
      // vezme aspoň časy zhlédnutí, ať se kvůli tomu nerozbije celá stránka.
      const viewsLog = await loadAllViews(videoIds);

      viewTimestamps = viewsLog.map((v) => new Date(v.viewed_at));

      // Odkud diváci přišli
      const sourceCounts: Record<string, number> = {};
      viewsLog.forEach((v) => {
        const key = v.source ?? 'unknown';
        sourceCounts[key] = (sourceCounts[key] ?? 0) + 1;
      });
      setViewSources(
        Object.entries(sourceCounts).map(([key, value]) => ({
          key,
          labelKey: viewSourceLabelKey(key),
          value,
        }))
      );

      // Kdy se lidi dívají - mřížka den v týdnu x hodina
      const heatmap = emptyHeatmap();
      viewsLog.forEach((v) => {
        const d = new Date(v.viewed_at);
        // getDay(): neděle = 0, u nás začíná týden pondělkem
        heatmap[(d.getDay() + 6) % 7][d.getHours()]++;
      });
      setWatchHeatmap(heatmap);

      const { count: commentCount } = await supabase
        .from('comments')
        .select('*', { count: 'exact', head: true })
        .in('video_id', videoIds);
      setTotalComments(commentCount ?? 0);

      // Doba sledování, dokoukanost a počty komentářů u jednotlivých videí.
      //
      // Nejde je spočítat přímo z prohlížeče: rozkoukanost videí je schválně
      // soukromá (každý vidí jen svoje řádky), takže by tvůrci vycházely
      // samé nuly. Sečte je proto funkce v databázi, která vrací jen souhrny
      // za video - nikdy ne to, kdo co sledoval a kam se dostal.
      const [{ data: perVideo, error: perVideoError }, { data: viewerCount }] = await Promise.all([
        supabase.rpc('creator_video_stats', { video_ids: videoIds }),
        supabase.rpc('creator_unique_viewers', { video_ids: videoIds }),
      ]);

      // Funkce přidává samostatná migrace. Dokud neproběhne, zbytek stránky
      // musí fungovat dál - jen se místo čísel ukáže pomlčka.
      setWatchStatsAvailable(!perVideoError);

      const commentsByVideo: Record<string, number> = {};
      const watchByVideo: Record<string, { seconds: number; completionSum: number; count: number }> = {};
      let totalWatchSeconds = 0;
      let completionSum = 0;
      let completionCount = 0;
      let finishedRows = 0;
      let watchRowCount = 0;

      (perVideo ?? []).forEach((row: any) => {
        commentsByVideo[row.video_id] = Number(row.comment_count ?? 0);
        const seconds = Number(row.watch_seconds ?? 0);
        const rowCompletionSum = Number(row.completion_sum ?? 0);
        const rowCompletionRows = Number(row.completion_rows ?? 0);

        watchByVideo[row.video_id] = {
          seconds,
          completionSum: rowCompletionSum,
          count: rowCompletionRows,
        };

        totalWatchSeconds += seconds;
        completionSum += rowCompletionSum;
        completionCount += rowCompletionRows;
        finishedRows += Number(row.finished_rows ?? 0);
        watchRowCount += Number(row.watch_rows ?? 0);
      });

      setWatchStats({
        totalWatchSeconds,
        avgCompletionPercent: completionCount > 0 ? completionSum / completionCount : null,
        finishedShare: watchRowCount > 0 ? (finishedRows / watchRowCount) * 100 : null,
        uniqueViewers: Number(viewerCount ?? 0),
      });

      const ratingByVideo: Record<string, { sum: number; count: number }> = {};
      (reactions ?? []).forEach((r: any) => {
        const bucket = ratingByVideo[r.video_id] ?? { sum: 0, count: 0 };
        bucket.sum += r.score ?? 3;
        bucket.count++;
        ratingByVideo[r.video_id] = bucket;
      });

      setVideoTable(
        (videos ?? []).map((v: any) => {
          const rating = ratingByVideo[v.id];
          const watch = watchByVideo[v.id];
          return {
            id: v.id,
            title: v.title,
            thumbnail_url: v.thumbnail_url ?? null,
            created_at: v.created_at,
            views: v.views ?? 0,
            avgRating: rating && rating.count > 0 ? rating.sum / rating.count : null,
            ratingCount: rating?.count ?? 0,
            comments: commentsByVideo[v.id] ?? 0,
            completionPercent: watch && watch.count > 0 ? watch.completionSum / watch.count : null,
            watchSeconds: watch?.seconds ?? 0,
          };
        })
      );

      const breakdown: Record<string, number[]> = {};
      const totals = [0, 0, 0, 0, 0];
      videoIds.forEach((id) => { breakdown[id] = [0, 0, 0, 0, 0]; });
      (reactions ?? []).forEach((r: any) => {
        const score = r.score ?? 3;
        if (breakdown[r.video_id] && score >= 1 && score <= 5) {
          breakdown[r.video_id][score - 1]++;
          totals[score - 1]++;
        }
      });
      setRatingsByVideo(breakdown);
      setRatingTotals(totals);
    }

    // Po dávkách - jeden dotaz vrátí nejvíc 1000 řádků a graf růstu by
    // kanálu nad tisíc odběratelů lhal.
    const subs = await fetchAllRows((from, to) =>
      supabase.from('subscriptions').select('created_at').eq('channel_id', authData.user!.id).order('created_at', { ascending: true }).range(from, to)
    );

    // Úroveň ověření a datum založení jsou veřejné, podíl z výdělků a
    // pozastavení výplat ne - ty vrací funkce my_account, a to jen
    // majiteli účtu.
    const [{ data: publicPart }, { data: accountRows }] = await Promise.all([
      supabase.from('profiles').select('verification_tier, created_at').eq('id', authData.user.id).single(),
      supabase.rpc('my_account'),
    ]);

    const account: any = Array.isArray(accountRows) ? accountRows[0] : accountRows;
    const profile: any = { ...(publicPart ?? {}), ...(account ?? {}) };

    setVerificationTier(profile?.verification_tier ?? 'none');
    setPayoutsSuspended(!!profile?.payouts_suspended);
    setRevenueShare({
      percent: profile?.revenue_share_percent ?? null,
      status: (profile?.partner_status ?? 'standard') as PartnerStatus,
      note: profile?.revenue_share_note ?? null,
      manual: !!profile?.revenue_share_manual,
    });

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
    // Stránka je širší než dřív - srovnávací tabulka a mřížka "kdy se lidi
    // dívají" potřebují místo, jinak by se pořád posouvaly do stran.
    <div style={{ maxWidth: 980 }}>
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
          <p className="panel-heading">{t('statsStarDistTitle')}</p>
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

      {/* Doba sledování a dokoukanost - počítá se z rozkoukanosti, kterou si
          appka u každého diváka ukládá kvůli "pokračuj, kde jsi skončil". */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">
          {t('statsWatchTimeTitle')}
          <FieldHint text={t('statsWatchTimeHint')} />
        </p>

        {!watchStatsAvailable && (
          <p style={{ fontSize: 12.5, color: '#e0b23f', margin: '0 0 12px' }}>
            {t('statsMigrationNeeded').replace('{file}', 'supabase-migration-view-sources.sql')}
          </p>
        )}

        <div className="stat-figure-row">
          <div>
            <p className="stat-figure">{formatWatchTime(watchStats.totalWatchSeconds)}</p>
            <p className="stat-caption">{t('statsTotalWatched')}</p>
          </div>
          <div>
            <p className="stat-figure">
              {watchStats.avgCompletionPercent === null ? '—' : `${Math.round(watchStats.avgCompletionPercent)} %`}
            </p>
            <p className="stat-caption">{t('statsAvgOfVideo')}</p>
          </div>
          <div>
            <p className="stat-figure">
              {watchStats.finishedShare === null ? '—' : `${Math.round(watchStats.finishedShare)} %`}
            </p>
            <p className="stat-caption">{t('statsFinishedShare')}</p>
          </div>
          <div>
            <p className="stat-figure">{watchStats.uniqueViewers}</p>
            <p className="stat-caption">{t('statsSignedInViewers')}</p>
          </div>
        </div>
      </div>

      {/* Kolik lidí kanál sleduje a kolik z nich se doopravdy ozve. */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">
          {t('statsEngagementTitle')}
          <FieldHint text={t('statsEngagementHint')} />
        </p>

        <div className="stat-figure-row">
          <div>
            <p className="stat-figure">{stats.subscriberCount}</p>
            <p className="stat-caption">{t('statsSubscribersShort')}</p>
          </div>
          <div>
            <p className="stat-figure">
              {stats.totalViews > 0
                ? `${(((stats.totalLikes + stats.totalDislikes) / stats.totalViews) * 100).toFixed(1)} %`
                : '—'}
            </p>
            <p className="stat-caption">{t('statsViewsWithReaction')}</p>
          </div>
          <div>
            <p className="stat-figure">
              {stats.totalViews > 0 ? `${((totalComments / stats.totalViews) * 100).toFixed(1)} %` : '—'}
            </p>
            <p className="stat-caption">{t('statsViewsWithComment')}</p>
          </div>
          <div>
            <p className="stat-figure">
              {stats.subscriberCount > 0 ? (stats.totalViews / stats.subscriberCount).toFixed(1) : '—'}
            </p>
            <p className="stat-caption">{t('statsViewsPerSubscriber')}</p>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">
          {t('statsSourcesTitle')}
          <FieldHint text={t('statsSourcesHint')} />
        </p>
        <StatsBarList
          items={viewSources.map((s) => ({
            key: s.key,
            // Cizí doména se nepřekládá, ukáže se tak, jak je.
            label: s.labelKey ? t(s.labelKey as any) : s.key,
            value: s.value,
          }))}
          emptyNote={t('statsSourcesEmpty')}
        />
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">
          {t('statsWhenTitle')}
          <FieldHint text={t('statsWhenHint')} />
        </p>
        <StatsHeatmap counts={watchHeatmap} />
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <p className="panel-heading">
          {t('statsCompareTitle')}
          <FieldHint text={t('statsCompareHint')} />
        </p>
        <StatsVideoTable rows={videoTable} />
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

      {/* Kolik z výdělku zůstává tvůrci a kolik jde platformě. */}
      {(() => {
        const percent = effectiveCreatorPercent(
          revenueShare.percent,
          revenueShare.manual,
          stats.subscriberCount
        );
        // Další stupeň má smysl slibovat jen tomu, komu se podíl řídí sám.
        const nextTier = revenueShare.manual ? null : nextTierFor(stats.subscriberCount);

        return (
          <div className="panel" style={{ marginBottom: 20 }}>
            <p className="panel-heading">
              {t('revenueShareLabel')}
              <FieldHint text={t('revenueSplitHint')} />
            </p>

            <div className="revenue-split-bar">
              <div className="revenue-split-creator" style={{ width: `${percent}%` }}>
                {percent >= 18 && <span>{t('revenueSplitYou')} {percent} %</span>}
              </div>
              <div className="revenue-split-platform" style={{ width: `${100 - percent}%` }}>
                {100 - percent >= 18 && <span>Kine {100 - percent} %</span>}
              </div>
            </div>

            {revenueShare.manual && (
              <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '10px 0 0' }}>
                {PARTNER_STATUS_LABELS[revenueShare.status]}
                {revenueShare.note ? ` · ${revenueShare.note}` : ''}
              </p>
            )}

            {nextTier && (
              <p style={{ fontSize: 12.5, color: 'var(--text-faint)', margin: '10px 0 0' }}>
                {t('revenueSplitNextTier')
                  .replace('{count}', String(nextTier.minSubscribers))
                  .replace('{percent}', String(nextTier.creatorPercent))
                  .replace('{missing}', String(nextTier.minSubscribers - stats.subscriberCount))}
              </p>
            )}
          </div>
        );
      })()}

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
                          {new Date(v.created_at).toLocaleDateString(DATE_LOCALES[lang])}
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
