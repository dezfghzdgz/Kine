'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function PlaylistDetailPage() {
  const { t } = useLanguage();
  const params = useParams();
  const router = useRouter();
  const playlistId = params.id as string;

  const [playlist, setPlaylist] = useState<any>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [recommended, setRecommended] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkInput, setLinkInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  // Prohlížeč po přetažení pošle ještě klik - tímhle ho spolkneme, ať
  // přesun videa neskončí odchodem na přehrávání.
  const justDraggedRef = useRef(false);

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

  function playVideoAt(index: number) {
    router.push(`/watch/${videos[index].id}?playlist=${playlistId}`);
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

  /**
   * Přesune video z jedné pozice na druhou a hned uloží nové pořadí.
   *
   * V seznamu se pořadí přepíše okamžitě, ať to nekouká zpožděně, a do
   * databáze se přepíšou pozice všech videí (proč, viz komentář níž).
   */
  async function moveVideo(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= videos.length) return;

    const reordered = [...videos];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setVideos(reordered);
    setSavingOrder(true);

    // Přečíslují se schválně všechna videa, ne jen ta přesunutá: videa
    // přidaná odjinud (z playlistu u videa, z kanálu, při nahrávání) mají
    // position rovnou 0, takže by se po přeuložení jen části pořadí
    // rozsypalo. Takhle se to při každém přesunu samo srovná.
    await Promise.all(
      reordered.map((v, i) =>
        supabase
          .from('playlist_videos')
          .update({ position: i })
          .eq('playlist_id', playlistId)
          .eq('video_id', v.id)
      )
    );
    setSavingOrder(false);
  }

  async function handleDrop(targetIndex: number) {
    const from = dragIndex;
    setDragIndex(null);
    setDropIndex(null);
    if (from === null) return;
    await moveVideo(from, targetIndex);
  }

  if (loading) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;
  if (!playlist) return <p>Playlist nenalezen.</p>;

  const isOwner = userId === playlist.owner_id;
  const firstVideo = videos[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
      <div>
        <p className="section-title">{playlist.title}</p>

        {firstVideo ? (
          <Link href={`/watch/${firstVideo.id}?playlist=${playlistId}`} className="player-wrap" style={{ aspectRatio: '16/9', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
            {firstVideo.thumbnail_url && (
              <Image src={firstVideo.thumbnail_url} alt={firstVideo.title} fill style={{ objectFit: 'cover' }} />
            )}
            <div className="play-badge" style={{ position: 'relative', fontSize: 32 }}>▶</div>
          </Link>
        ) : (
          <div className="player-wrap" style={{ aspectRatio: '16/9', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--text-faint)' }}>Tenhle playlist zatím neobsahuje žádná videa.</p>
          </div>
        )}

        {firstVideo && (
          <>
            <h1 className="video-title">{firstVideo.title}</h1>
            <p className="video-meta">{firstVideo.profiles?.username ?? t('unknownCreator')} · {firstVideo.views} {t('views')}</p>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <p className="panel-heading" style={{ margin: 0 }}>Playlist ({videos.length})</p>
          {savingOrder && <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{t('playlistSavingOrder')}</span>}
        </div>

        {isOwner && videos.length > 1 && (
          <p style={{ fontSize: 11.5, color: 'var(--text-faint)', margin: '6px 0 10px' }}>
            {t('playlistReorderHint')}
          </p>
        )}

        {/* Přehazování videí: šipky fungují všude včetně mobilu, tažení za
            úchyt je rychlejší na počítači. Tahat jde jen za ⠿, ať se
            omylem nespustí video při snaze video přesunout. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
          {videos.map((v, i) => (
            <div
              key={v.id}
              draggable={isOwner}
              onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
                // Značka platí jen na okamžik po puštění. Bez toho by
                // zůstala viset napořád a spolkla by i další obyčejný klik.
                justDraggedRef.current = true;
                setTimeout(() => { justDraggedRef.current = false; }, 150);
              }}
              onDragOver={(e) => { e.preventDefault(); if (dropIndex !== i) setDropIndex(i); }}
              onDragLeave={() => { if (dropIndex === i) setDropIndex(null); }}
              onDrop={() => handleDrop(i)}
              // Po přetažení se video nesmí zároveň spustit - dřív tažení
              // často skončilo tím, že appka odešla na přehrávání.
              onClick={() => {
                if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                playVideoAt(i);
              }}
              className={`panel playlist-row ${dragIndex === i ? 'dragging' : ''} ${dropIndex === i && dragIndex !== i ? 'drop-target' : ''}`}
            >
              {isOwner && (
                <>
                  <span
                    className="playlist-row-handle"
                    title={t('playlistDragHandle')}
                    onClick={(e) => e.stopPropagation()}
                  >
                    ⠿
                  </span>
                  <span className="playlist-move-btns" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="playlist-move-btn"
                      disabled={i === 0}
                      onClick={() => moveVideo(i, i - 1)}
                      title={t('playlistMoveUp')}
                      aria-label={t('playlistMoveUp')}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="playlist-move-btn"
                      disabled={i === videos.length - 1}
                      onClick={() => moveVideo(i, i + 1)}
                      title={t('playlistMoveDown')}
                      aria-label={t('playlistMoveDown')}
                    >
                      ▼
                    </button>
                  </span>
                </>
              )}
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
                <Link
                  href={`/watch/${v.id}`}
                  key={v.id}
                  className="panel"
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 8, cursor: 'pointer' }}
                >
                  <div style={{ width: 64, height: 36, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--panel-raised)' }}>
                    {v.thumbnail_url && <Image src={v.thumbnail_url} alt={v.title} width={64} height={36} style={{ objectFit: 'cover' }} />}
                  </div>
                  <p style={{ fontSize: 12.5, margin: 0, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {v.title}
                  </p>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
