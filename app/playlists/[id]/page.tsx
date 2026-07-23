'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Script from 'next/script';
import { supabase } from '@/lib/supabaseClient';
import ChapterTimeline from '@/components/ChapterTimeline';
import { useLanguage } from '@/lib/i18n';

export default function PlaylistDetailPage() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const playlistId = params.id as string;

  const [playlist, setPlaylist] = useState<any>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playingRecommendedId, setPlayingRecommendedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkInput, setLinkInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [playerReady, setPlayerReady] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [playlistId]);

  async function load() {
    const { data: playlistData } = await supabase
      .from('playlists')
      .select('id, title, owner_id, color, thumbnail_url, is_system')
      .eq('id', playlistId)
      .single();
    setPlaylist(playlistData);

    const { data: items } = await supabase
      .from('playlist_videos')
      .select('video_id, position')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true });

    const videoIds = (items ?? []).map((i) => i.video_id);

    if (videoIds.length > 0) {
      const { data: videoData } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, cloudflare_video_id, duration_seconds, views, profiles!videos_owner_id_fkey(username)')
        .in('id', videoIds);

      const ordered = videoIds.map((id) => videoData?.find((v) => v.id === id)).filter(Boolean) as any[];
      setVideos(ordered);

      const { data: rec } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, cloudflare_video_id, duration_seconds, profiles!videos_owner_id_fkey(username)')
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .not('id', 'in', `(${videoIds.join(',')})`)
        .order('views', { ascending: false })
        .limit(12);
      setRecommended(rec ?? []);
    } else {
      const { data: rec } = await supabase
        .from('videos')
        .select('id, title, thumbnail_url, views, cloudflare_video_id, duration_seconds, profiles!videos_owner_id_fkey(username)')
        .eq('status', 'ready')
        .eq('visibility', 'public')
        .order('views', { ascending: false })
        .limit(12);
      setRecommended(rec ?? []);
    }

    setLoading(false);
  }

  function handlePlayerSdkReady() {
    if (iframeRef.current && (window as any).Stream) {
      playerRef.current = (window as any).Stream(iframeRef.current);
      playerRef.current.muted = false;
      playerRef.current.volume = 1;
      playerRef.current.play?.();
      setPlayerReady(true);
    }
  }

  useEffect(() => {
    setPlayerReady(false);
    playerRef.current = null;

    const interval = setInterval(() => {
      if (iframeRef.current && (window as any).Stream && !playerRef.current) {
        handlePlayerSdkReady();
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [currentIndex, playingRecommendedId, videos.length]);

  // Automatické přehrání dalšího videa po skončení toho aktuálního
  useEffect(() => {
    if (!playerReady || !playerRef.current) return;
    const player = playerRef.current;

    function handleEnded() {
      playNext();
    }
    player.addEventListener?.('ended', handleEnded);
    return () => player.removeEventListener?.('ended', handleEnded);
  }, [playerReady, currentIndex, playingRecommendedId]);

  function playNext() {
    if (playingRecommendedId) {
      // Právě jsme dohráli doporučené video - pokračujeme dalším doporučeným
      const idx = recommended.findIndex((v) => v.id === playingRecommendedId);
      if (idx >= 0 && idx + 1 < recommended.length) {
        setPlayingRecommendedId(recommended[idx + 1].id);
      }
      return;
    }
    if (currentIndex + 1 < videos.length) {
      setCurrentIndex(currentIndex + 1);
    } else if (recommended.length > 0) {
      setPlayingRecommendedId(recommended[0].id);
    }
  }

  function playVideoAt(index: number) {
    setPlayingRecommendedId(null);
    setCurrentIndex(index);
  }

  function playRecommended(id: string) {
    setPlayingRecommendedId(id);
  }

  async function handleAddByLink(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    const match = linkInput.trim().match(/\/watch\/([a-f0-9-]{36})/i) || linkInput.trim().match(/^[a-f0-9-]{36}$/i);
    const videoIdToAdd = match ? (match[1] ?? match[0]) : null;
    if (!videoIdToAdd) {
      setAddError('Nepodařilo se z odkazu poznat video. Vlož odkaz na video z Kine.');
      return;
    }
    const { error } = await supabase.from('playlist_videos').upsert({
      playlist_id: playlistId, video_id: videoIdToAdd, position: videos.length,
    });
    if (error) {
      setAddError('Přidání se nepovedlo: ' + error.message);
      return;
    }
    setLinkInput('');
    load();
  }

  async function removeVideo(videoId: string) {
    await supabase.from('playlist_videos').delete().eq('playlist_id', playlistId).eq('video_id', videoId);
    load();
  }

  async function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) return;
    const reordered = [...videos];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setVideos(reordered);
    setDragIndex(null);

    await Promise.all(
      reordered.map((v, i) =>
        supabase.from('playlist_videos').update({ position: i }).eq('playlist_id', playlistId).eq('video_id', v.id)
      )
    );
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  if (!playlist) return <p>Playlist nenalezen.</p>;

  const isOwner = userId === playlist.owner_id;
  const nowPlaying = playingRecommendedId
    ? recommended.find((v) => v.id === playingRecommendedId)
    : videos[currentIndex];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
      <Script src="https://embed.cloudflarestream.com/embed/sdk.latest.js" onLoad={handlePlayerSdkReady} />

      <div>
        <p className="section-title">{playlist.title}</p>

        {nowPlaying?.cloudflare_video_id ? (
          <div ref={wrapRef} className="player-wrap" style={{ aspectRatio: '16/9', marginBottom: 12 }}>
            <iframe
              ref={iframeRef}
              src={`https://iframe.videodelivery.net/${nowPlaying.cloudflare_video_id}?controls=false`}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
              allowFullScreen
            />
            {playerReady && <ChapterTimeline chapters={[]} duration={nowPlaying?.duration_seconds ?? 0} player={playerRef.current} />}
          </div>
        ) : (
          <div className="player-wrap" style={{ aspectRatio: '16/9', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--text-faint)' }}>Tenhle playlist zatím neobsahuje žádná videa.</p>
          </div>
        )}

        {nowPlaying && (
          <>
            <h1 className="video-title">{nowPlaying.title}</h1>
            <p className="video-meta">{nowPlaying.profiles?.username ?? 'neznámý tvůrce'} · {nowPlaying.views} {t('views')}</p>
            {playingRecommendedId && (
              <p style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>
                Playlist skončil - přehráváme doporučená videa.
              </p>
            )}
          </>
        )}

        {isOwner && (
          <form onSubmit={handleAddByLink} style={{ display: 'flex', gap: 8, margin: '20px 0', maxWidth: 480 }}>
            <input
              type="text"
              placeholder={t('pasteVideoLink')}
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit">{t('addToPlaylist')}</button>
          </form>
        )}
        {addError && <p className="error-text">{addError}</p>}
      </div>

      <div>
        <p className="panel-heading">Playlist ({videos.length})</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
          {videos.map((v, i) => (
            <div
              key={v.id}
              draggable={isOwner}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              onClick={() => playVideoAt(i)}
              className="panel"
              style={{
                display: 'flex', gap: 10, alignItems: 'center', padding: 8, cursor: 'pointer',
                border: !playingRecommendedId && i === currentIndex ? '1px solid var(--text)' : '1px solid var(--border)',
              }}
            >
              {isOwner && <span style={{ cursor: 'grab', color: 'var(--text-faint)', fontSize: 14 }}>⠿</span>}
              <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 16, flexShrink: 0 }}>{i + 1}</span>
              <div style={{ width: 64, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--panel-raised)' }}>
                {v.thumbnail_url && <Image src={v.thumbnail_url} alt={v.title} width={64} height={36} style={{ objectFit: 'cover' }} />}
              </div>
              <p style={{ fontSize: 12.5, margin: 0, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {v.title}
              </p>
              {isOwner && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeVideo(v.id); }}
                  style={{ background: 'none', color: 'var(--text-faint)', padding: 4, fontSize: 12 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {recommended.length > 0 && (
          <>
            <p className="panel-heading">{t('recommendedNext')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recommended.map((v) => (
                <div
                  key={v.id}
                  onClick={() => playRecommended(v.id)}
                  className="panel"
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: 8, cursor: 'pointer',
                    border: playingRecommendedId === v.id ? '1px solid var(--text)' : '1px solid var(--border)',
                  }}
                >
                  <div style={{ width: 64, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--panel-raised)' }}>
                    {v.thumbnail_url && <Image src={v.thumbnail_url} alt={v.title} width={64} height={36} style={{ objectFit: 'cover' }} />}
                  </div>
                  <p style={{ fontSize: 12.5, margin: 0, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.title}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
