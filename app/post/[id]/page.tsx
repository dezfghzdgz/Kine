'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import PostCard from '@/components/PostCard';
import LoadFailed from '@/components/LoadFailed';
import { markPostSeen } from '@/lib/homePosts';

/** Jeden příspěvek (odkaz ze sdílení, z oznámení): celý, s komentáři. */
export default function PostPage() {
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [post, setPost] = useState<any | null | undefined>(undefined);
  const [userId, setUserId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    setFailed(false);
    const [{ data: auth }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from('posts')
        .select('*, profiles!posts_owner_id_fkey(id, username, display_name, avatar_url, verification_tier)')
        .eq('id', params.id)
        .maybeSingle(),
    ]);
    setUserId(auth.user?.id ?? null);
    if (error) {
      setFailed(true);
      return;
    }
    setPost(data ?? null);
    // Otevřený příspěvek se v řadě novinek na hlavní stránce už neukáže (lib/homePosts.ts).
    if (data) markPostSeen(String(data.id));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (failed) return <LoadFailed onRetry={load} />;
  if (post === undefined) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  if (post === null) {
    return (
      <div className="auth-gate">
        <p>{t('postNotFound')}</p>
        <Link href="/">{t('home')}</Link>
      </div>
    );
  }
  const author = post.profiles ?? null;
  return (
    <div className="post-page">
      {author && (
        <Link href={`/channel/${author.id}`} className="post-page-back">
          {t('postBackToChannel')}
        </Link>
      )}
      <PostCard post={post} userId={userId} author={author} startWithComments onDeleted={() => router.push(author ? `/channel/${author.id}` : '/')} />
    </div>
  );
}
