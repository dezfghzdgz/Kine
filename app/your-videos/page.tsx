'use client';

import { Suspense, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import Image from 'next/image';
import ConfirmDialog from '@/components/ConfirmDialog';
import { buildVideoBlocks } from '@/lib/videoBlocks';

function YourVideosPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmVideoId, setConfirmVideoId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, views, status, width, height, duration_seconds, created_at')
      .eq('owner_id', authData.user.id)
      .order('created_at', { ascending: false });

    const list = data ?? [];
    setVideos(list);
    setLoading(false);

    const stillProcessing = list.filter((v: any) => v.status !== 'ready');
    if (stillProcessing.length > 0) {
      await Promise.all(
        stillProcessing.map((v: any) =>
          fetch('/api/videos/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId: v.id }),
          })
        )
      );
      const { data: refreshed } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, status, width, height, duration_seconds, created_at')
        .eq('owner_id', authData.user.id)
        .order('created_at', { ascending: false });
      setVideos(refreshed ?? list);
    }
  }

  async function handleDelete(videoId: string) {

    setDeletingId(videoId);
    const { data: sessionData } = await supabase.auth.getSession();

    const res = await fetch('/api/videos/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token}`,
      },
      body: JSON.stringify({ videoId }),
    });

    if (res.ok) {
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
    } else {
      const data = await res.json();
      alert('Smazání se nepovedlo: ' + data.error);
    }
    setDeletingId(null);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  const filtered = query ? videos.filter((v) => v.title.toLowerCase().includes(query)) : videos;

  if (videos.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-faint)' }}>
        <p>{t('noVideosUploadedYet')}</p>
        <Link href="/upload" style={{ color: 'var(--text)' }}>{t('uploadFirstVideo')}</Link>
      </div>
    );
  }

  return (
    <div>
      <p className="section-title">{t('yourVideosTitle')}</p>
      {buildVideoBlocks(filtered).map((block, bi) => (
        <div key={bi} className={block.type === 'sparks' ? 'shorts-grid' : 'video-grid'} style={{ marginBottom: 20 }}>
          {block.items.map((video: any) => (
            <div key={video.id}>
              <Link href={`/watch/${video.id}`} className="video-card">
                <div className={block.type === 'sparks' ? 'video-thumb video-thumb-vertical' : 'video-thumb'}>
                  {video.thumbnail_url ? (
                    <Image src={video.thumbnail_url} alt={video.title} width={320} height={180} />
                  ) : null}
                  <div className="play-badge">▶</div>
                </div>
                <p className="video-card-title">{video.title}</p>
                <p className="video-card-meta">
                  {video.status === 'ready' ? `${video.views} {t('views')}` : 'Zpracovává se…'}
                </p>
              </Link>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <Link href={`/your-videos/${video.id}/edit`} style={{ flex: 1 }}>
                  <button style={{ width: '100%', background: 'var(--panel-raised)', color: 'var(--text)', fontSize: 12 }}>
                    {t('edit')}
                  </button>
                </Link>
                <button
                  onClick={() => setConfirmVideoId(video.id)}
                  disabled={deletingId === video.id}
                  style={{
                    flex: 1, background: 'var(--panel-raised)',
                    color: '#ff6b6b', border: '1px solid var(--border)', fontSize: 12,
                  }}
                >
                  {deletingId === video.id ? t('deletingVideo') : t('deleteVideoBtn')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {confirmVideoId && (
        <ConfirmDialog
          message={t('confirmDeleteVideo')}
          onConfirm={() => { handleDelete(confirmVideoId); setConfirmVideoId(null); }}
          onCancel={() => setConfirmVideoId(null)}
        />
      )}
    </div>
  );
}

export default function YourVideosPage() {
  return (
    <Suspense fallback={null}>
      <YourVideosPageInner />
    </Suspense>
  );
}
