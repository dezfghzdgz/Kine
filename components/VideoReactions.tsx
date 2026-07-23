'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { ThumbsUpIcon, ThumbsDownIcon } from './ReactionIcons';
import { shouldNotifyLikeMilestone } from '@/lib/likeMilestones';

type RatingMode = 'stars' | 'like_dislike';

export default function VideoReactions({ videoId, ownerId }: { videoId: string; ownerId?: string }) {
  const router = useRouter();
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [totalRatings, setTotalRatings] = useState(0);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [ratingMode, setRatingMode] = useState<RatingMode>('like_dislike');
  const [hoverStar, setHoverStar] = useState<number | null>(null);

  useEffect(() => {
    loadReactions();
    loadMyPreference();
  }, [videoId]);

  async function loadMyPreference() {
    const { data: authData } = await supabase.auth.getUser();
    setUserId(authData.user?.id ?? null);
    if (!authData.user) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('rating_mode')
      .eq('id', authData.user.id)
      .single();

    setRatingMode((profile?.rating_mode as RatingMode) ?? 'like_dislike');
  }

  async function loadReactions() {
    const { data } = await supabase
      .from('video_reactions')
      .select('score, user_id')
      .eq('video_id', videoId);

    if (!data || data.length === 0) {
      setAvgScore(null);
      setTotalRatings(0);
    } else {
      const avg = data.reduce((sum, r) => sum + (r.score ?? 3), 0) / data.length;
      setAvgScore(avg);
      setTotalRatings(data.length);
    }

    const { data: authData } = await supabase.auth.getUser();
    const mine = data?.find((r) => r.user_id === authData.user?.id);
    setMyScore(mine?.score ?? null);
  }

  async function submitScore(score: number) {
    if (!userId) {
      router.push('/login');
      return;
    }

    if (myScore === score) {
      // Klik na už aktivní hodnocení ho zruší
      await supabase.from('video_reactions').delete().eq('video_id', videoId).eq('user_id', userId);
    } else {
      const wasAlreadyLike = myScore !== null && myScore >= 4;
      await supabase.from('video_reactions').upsert({
        video_id: videoId,
        user_id: userId,
        score,
        reaction: score >= 4 ? 'like' : score <= 2 ? 'dislike' : null,
      });

      // Notifikace tvůrci podle milníků (do 5 lajků na každý, pak jen kulaté počty)
      if (score >= 4 && !wasAlreadyLike && ownerId && ownerId !== userId) {
        const { count } = await supabase
          .from('video_reactions')
          .select('*', { count: 'exact', head: true })
          .eq('video_id', videoId)
          .gte('score', 4);

        if (count && shouldNotifyLikeMilestone(count)) {
          await supabase.from('notifications').insert({
            user_id: ownerId,
            message: `Tvoje video dosáhlo ${count} ${count === 1 ? 'lajku' : 'lajků'}!`,
            link: `/watch/${videoId}`,
          });
        }
      }
    }
    loadReactions();
  }

  const likeCount = null; // veřejně ukazujeme jen průměr, ne rozdělení na like/dislike počty

  if (ratingMode === 'stars') {
    return (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="star-row">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hoverStar ?? myScore ?? 0) >= n;
            return (
              <span
                key={n}
                className={`star ${filled ? 'filled' : ''}`}
                onClick={() => submitScore(n)}
                onMouseEnter={() => setHoverStar(n)}
                onMouseLeave={() => setHoverStar(null)}
              >
                ★
              </span>
            );
          })}
          {avgScore !== null && (
            <span style={{ color: 'var(--text-faint)', fontSize: 13, marginLeft: 8, alignSelf: 'center' }}>
              {avgScore.toFixed(1)}/5 ({totalRatings})
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="reaction-row">
      <button className={`reaction-btn ${myScore === 5 ? 'active' : ''}`} onClick={() => submitScore(5)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ThumbsUpIcon filled={myScore === 5} size={16} />
        {avgScore !== null ? `${Math.round(((avgScore - 1) / 4) * 100)}%` : ''}
      </button>
      <button className={`reaction-btn ${myScore === 1 ? 'active' : ''}`} onClick={() => submitScore(1)} style={{ display: 'flex', alignItems: 'center' }}>
        <ThumbsDownIcon filled={myScore === 1} size={16} />
      </button>
      {totalRatings > 0 && (
        <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>{totalRatings} hodnocení</span>
      )}
    </div>
  );
}
