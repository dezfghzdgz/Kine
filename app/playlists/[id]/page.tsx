'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';
import UiIcon from '@/components/UiIcon';
import { PlaylistIcon } from '@/components/ReactionIcons';
import { formatDuration } from '@/lib/homeRecommendation';
import { hasChosenColor } from '@/lib/playlistCover';

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
      .select('id, title, owner_id, color, thumbnail_url, is_system, visibility')
      .eq('id', playlistId)
      .single();
    // Kdo playlist sestavil - zvlášť, ať případná chyba nerozbije celou stránku.
    let ownerProfile: { username: string | null; display_name: string | null } | null = null;
    if (playlistData?.owner_id) {
      const { data: ownerRow } = await supabase.from('profiles').select('username, display_name').eq('id', playlistData.owner_id).maybeSingle();
      ownerProfile = (ownerRow as any) ?? null;
    }
    setPlaylist(playlistData ? { ...playlistData, profiles: ownerProfile } : null);

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
      setAddError(t('playlistLinkInvalid'));
      return;
    }
    const { error } = await supabase.from('playlist_videos').upsert({
      playlist_id: playlistId, video_id: videoIdToAdd, position: videos.length,
    });
    if (error) {
      setAddError(t('playlistAddFailed').replace('{error}', error.message));
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
  if (!playlist) return <p>{t('playlistNotFound')}</p>;

  const isOwner = userId === playlist.owner_id;
  const firstVideo = videos[0];
  // Vlastní obrázek > vybraná barva > náhled prvního videa (lib/playlistCover.ts).
  const cover = playlist.thumbnail_url || (hasChosenColor(playlist.color) ? null : firstVideo?.thumbnail_url) || null;
  const coverStyle = cover ? undefined : { background: `linear-gradient(135deg, ${playlist.color ?? '#3a3a40'}, #111114)` };
  const totalSeconds = videos.reduce((sum, v) => sum + (Number(v.duration_seconds) || 0), 0);
  const owner = Array.isArray(playlist.profiles) ? playlist.profiles[0] : playlist.profiles;
  const isPublic = playlist.visibility === 'public';

  return (
    <div className="playlist-page">
      {/* Vlevo (na mobilu nahoře): obal, název, kolik videí a jak dlouho, Přehrát vše. */}
      <section className="playlist-hero" style={{ ['--playlist-tint' as string]: playlist.color ?? '#3a3a40' }}>
        {cover && <div className="playlist-hero-backdrop" style={{ backgroundImage: `url("${cover}")` }} aria-hidden="true" />}
        <div className="playlist-hero-body">
          {firstVideo ? (
            <Link href={`/watch/${firstVideo.id}?playlist=${playlistId}`} className="playlist-hero-cover" style={coverStyle}>
              {cover ? <Image src={cover} alt="" fill sizes="(max-width: 900px) 100vw, 380px" style={{ objectFit: 'cover' }} /> : <PlaylistIcon size={40} />}
              <span className="playlist-hero-play" aria-hidden="true">
                <UiIcon name="play" size={26} />
              </span>
            </Link>
          ) : (
            <div className="playlist-hero-cover empty" style={coverStyle}>
              {cover ? <Image src={cover} alt="" fill sizes="(max-width: 900px) 100vw, 380px" style={{ objectFit: 'cover' }} /> : <PlaylistIcon size={40} />}
            </div>
          )}
          <h1 className="playlist-hero-title">{playlist.title}</h1>
          <p className="playlist-hero-meta">
            {owner?.username && (
              <Link href={`/channel/${playlist.owner_id}`} className="playlist-hero-owner">
                {owner.display_name ?? owner.username}
              </Link>
            )}
            <span>
              {videos.length} {t('playlistVideoCountSuffix')}
            </span>
            {totalSeconds > 0 && <span>{formatDuration(totalSeconds)}</span>}
            <span className="playlist-hero-visibility">
              <UiIcon name={isPublic ? 'globe' : 'lock'} size={12} />
              {isPublic ? t('playlistVisibilityPublic') : t('playlistVisibilityPrivate')}
            </span>
          </p>
          {firstVideo ? (
            <button type="button" className="playlist-play-all" onClick={() => playVideoAt(0)}>
              <UiIcon name="play" size={16} />
              {t('playlistPlayAll')}
            </button>
          ) : (
            <p className="playlist-hero-empty">{t('playlistEmptyNote')}</p>
          )}
          {isOwner && (
            <form onSubmit={handleAddByLink} className="playlist-add-link">
              <UiIcon name="link" size={15} />
              <input type="text" placeholder={t('pasteVideoLink')} value={linkInput} onChange={(e) => setLinkInput(e.target.value)} aria-label={t('pasteVideoLink')} />
              <button type="submit" disabled={!linkInput.trim()}>
                {t('addToPlaylist')}
              </button>
            </form>
          )}
          {addError && <p className="error-text">{addError}</p>}
        </div>
      </section>

      <section className="playlist-list">
        <div className="playlist-list-head">
          <p className="panel-heading" style={{ margin: 0 }}>
            {t('playlistListHeading')} <span className="playlist-list-count">{videos.length}</span>
          </p>
          {savingOrder && <span className="playlist-saving">{t('playlistSavingOrder')}</span>}
        </div>

        {isOwner && videos.length > 1 && <p className="playlist-reorder-hint">{t('playlistReorderHint')}</p>}

        {/* Přehazování videí: šipky fungují všude včetně mobilu, tažení za
            úchyt je rychlejší na počítači. Tahat jde jen za úchyt, ať se
            omylem nespustí video při snaze video přesunout. */}
        <div className="playlist-rows">
          {videos.map((v, i) => (
            <div
              key={v.id}
              draggable={isOwner}
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDropIndex(null);
                // Značka platí jen na okamžik po puštění. Bez toho by
                // zůstala viset napořád a spolkla by i další obyčejný klik.
                justDraggedRef.current = true;
                setTimeout(() => {
                  justDraggedRef.current = false;
                }, 150);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dropIndex !== i) setDropIndex(i);
              }}
              onDragLeave={() => {
                if (dropIndex === i) setDropIndex(null);
              }}
              onDrop={() => handleDrop(i)}
              // Po přetažení se video nesmí zároveň spustit - dřív tažení
              // často skončilo tím, že appka odešla na přehrávání.
              onClick={() => {
                if (justDraggedRef.current) {
                  justDraggedRef.current = false;
                  return;
                }
                playVideoAt(i);
              }}
              className={`playlist-row ${dragIndex === i ? 'dragging' : ''} ${dropIndex === i && dragIndex !== i ? 'drop-target' : ''}`}
            >
              {isOwner && (
                <span className="playlist-row-handle" title={t('playlistDragHandle')} onClick={(e) => e.stopPropagation()} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.6" />
                    <circle cx="15" cy="6" r="1.6" />
                    <circle cx="9" cy="12" r="1.6" />
                    <circle cx="15" cy="12" r="1.6" />
                    <circle cx="9" cy="18" r="1.6" />
                    <circle cx="15" cy="18" r="1.6" />
                  </svg>
                </span>
              )}
              <span className="playlist-row-index">{i + 1}</span>
              <div className="playlist-row-thumb">
                {v.thumbnail_url && <Image src={v.thumbnail_url} alt="" width={128} height={72} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />}
                {v.duration_seconds ? <span className="playlist-row-duration">{formatDuration(v.duration_seconds)}</span> : null}
              </div>
              <div className="playlist-row-text">
                <p className="playlist-row-title">{v.title}</p>
                <p className="playlist-row-meta">
                  {v.profiles?.username ?? t('unknownCreator')} · {v.views ?? 0} {t('views')}
                </p>
              </div>
              {isOwner && (
                <span className="playlist-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => moveVideo(i, i - 1)} title={t('playlistMoveUp')} aria-label={t('playlistMoveUp')}>
                    <UiIcon name="chevronDown" size={15} className="flip-y" />
                  </button>
                  <button type="button" className="icon-btn" disabled={i === videos.length - 1} onClick={() => moveVideo(i, i + 1)} title={t('playlistMoveDown')} aria-label={t('playlistMoveDown')}>
                    <UiIcon name="chevronDown" size={15} />
                  </button>
                  <button type="button" className="icon-btn" onClick={() => removeVideo(v.id)} title={t('playlistRemoveVideo')} aria-label={t('playlistRemoveVideo')}>
                    <UiIcon name="close" size={15} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>

        {recommended.length > 0 && (
          <>
            <p className="panel-heading" style={{ marginTop: 26 }}>{t('recommendedNext')}</p>
            <div className="playlist-rows">
              {recommended.map((v) => (
                <Link href={`/watch/${v.id}`} key={v.id} className="playlist-row">
                  <div className="playlist-row-thumb">
                    {v.thumbnail_url && <Image src={v.thumbnail_url} alt="" width={128} height={72} style={{ objectFit: 'cover', width: '100%', height: '100%' }} />}
                    {v.duration_seconds ? <span className="playlist-row-duration">{formatDuration(v.duration_seconds)}</span> : null}
                  </div>
                  <div className="playlist-row-text">
                    <p className="playlist-row-title">{v.title}</p>
                    <p className="playlist-row-meta">
                      {v.profiles?.username ?? t('unknownCreator')} · {v.views ?? 0} {t('views')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
