'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import PostComments from './PostComments';
import { ThumbsUpIcon, ThumbsDownIcon } from './ReactionIcons';

export default function PostCard({ post, userId }: { post: any; userId: string | null }) {
  const router = useRouter();
  const [options, setOptions] = useState<{ text: string; votes: number }[]>(post.poll_options ?? []);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [myReaction, setMyReaction] = useState<'like' | 'dislike' | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [dislikeCount, setDislikeCount] = useState(0);

  useEffect(() => {
    if (post.type === 'poll') loadVote();
    loadCommentCount();
    loadReactions();
  }, []);

  async function loadReactions() {
    const { data } = await supabase.from('post_reactions').select('user_id, reaction').eq('post_id', post.id);
    setLikeCount((data ?? []).filter((r) => r.reaction === 'like').length);
    setDislikeCount((data ?? []).filter((r) => r.reaction === 'dislike').length);
    const mine = (data ?? []).find((r) => r.user_id === userId);
    setMyReaction((mine?.reaction as 'like' | 'dislike') ?? null);
  }

  async function react(reaction: 'like' | 'dislike') {
    if (!userId) { router.push('/login'); return; }
    if (myReaction === reaction) {
      await supabase.from('post_reactions').delete().eq('post_id', post.id).eq('user_id', userId);
    } else {
      await supabase.from('post_reactions').upsert({ post_id: post.id, user_id: userId, reaction });
    }
    loadReactions();
  }

  async function loadVote() {
    if (!userId) return;
    const { data } = await supabase
      .from('post_votes')
      .select('option_index')
      .eq('post_id', post.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (data) setMyVote(data.option_index);
  }

  async function loadCommentCount() {
    const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
    setCommentCount(count ?? 0);
  }

  async function vote(index: number) {
    if (!userId) { router.push('/login'); return; }
    if (myVote !== null) return;

    await supabase.from('post_votes').insert({ post_id: post.id, user_id: userId, option_index: index });
    const updated = [...options];
    updated[index] = { ...updated[index], votes: (updated[index].votes ?? 0) + 1 };
    setOptions(updated);
    setMyVote(index);
    await supabase.from('posts').update({ poll_options: updated }).eq('id', post.id);
  }

  const totalVotes = options.reduce((s, o) => s + (o.votes ?? 0), 0);

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      {post.content && <p style={{ fontSize: 14, marginTop: 0, whiteSpace: 'pre-wrap' }}>{post.content}</p>}

      {post.type === 'photo' && post.image_url && (
        <img src={post.image_url} alt="" style={{ width: '100%', borderRadius: 8, marginTop: post.content ? 10 : 0 }} />
      )}

      {post.type === 'poll' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {options.map((opt, i) => {
            const percent = totalVotes > 0 ? Math.round(((opt.votes ?? 0) / totalVotes) * 100) : 0;
            return (
              <div
                key={i}
                onClick={() => vote(i)}
                style={{
                  position: 'relative', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
                  cursor: myVote === null ? 'pointer' : 'default', overflow: 'hidden',
                }}
              >
                {myVote !== null && (
                  <div style={{ position: 'absolute', inset: 0, width: `${percent}%`, background: 'var(--panel-raised)', zIndex: 0 }} />
                )}
                <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{opt.text} {myVote === i ? '✓' : ''}</span>
                  {myVote !== null && <span style={{ color: 'var(--text-faint)' }}>{percent}%</span>}
                </div>
              </div>
            );
          })}
          {totalVotes > 0 && <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>{totalVotes} hlasů</p>}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10, marginBottom: 0 }}>
        {new Date(post.created_at).toLocaleDateString('cs-CZ')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <button
          onClick={() => react('like')}
          style={{ background: 'none', color: myReaction === 'like' ? 'var(--text)' : 'var(--text-faint)', padding: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
        >
          <ThumbsUpIcon filled={myReaction === 'like'} size={15} /> {likeCount > 0 ? likeCount : ''}
        </button>
        <button
          onClick={() => react('dislike')}
          style={{ background: 'none', color: myReaction === 'dislike' ? 'var(--text)' : 'var(--text-faint)', padding: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}
        >
          <ThumbsDownIcon filled={myReaction === 'dislike'} size={15} /> {dislikeCount > 0 ? dislikeCount : ''}
        </button>
        <button
          onClick={() => setCommentsOpen((v) => !v)}
          style={{ background: 'none', color: 'var(--text-faint)', padding: 0, fontSize: 12 }}
        >
          💬 {commentCount > 0 ? commentCount : ''} Komentáře
        </button>
      </div>

      {commentsOpen && (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          <PostComments postId={post.id} onCommentAdded={loadCommentCount} />
        </div>
      )}
    </div>
  );
}
