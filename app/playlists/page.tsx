'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ConfirmDialog from '@/components/ConfirmDialog';
import UiIcon from '@/components/UiIcon';
import { PlaylistIcon } from '@/components/ReactionIcons';
import { DEFAULT_PLAYLIST_COLOR, hasChosenColor, playlistCover } from '@/lib/playlistCover';
import { IMAGE_MAX_BYTES, imageUploadExt, imageUploadProblem } from '@/lib/imageUpload';

const COLOR_PRESETS = ['#3a5a8a', '#8a3a3a', '#3a8a5a', '#8a7a3a', '#6a3a8a', '#3a3a40'];

function PlaylistsPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() ?? '';
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmPlaylistId, setConfirmPlaylistId] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function load() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setChecking(false);
      return;
    }
    setUserId(authData.user.id);

    const { data } = await supabase
      .from('playlists')
      .select('id, title, color, thumbnail_url, is_system, visibility, created_at, playlist_videos(video_id, position, videos(thumbnail_url))')
      .eq('owner_id', authData.user.id)
      .order('is_system', { ascending: false })
      .order('created_at', { ascending: false });

    setPlaylists(data ?? []);
    setChecking(false);
  }

  async function createPlaylist(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !userId) return;
    setCreating(true);
    await supabase.from('playlists').insert({ owner_id: userId, title: newTitle.trim() });
    setNewTitle('');
    setCreating(false);
    load();
  }

  async function renamePlaylist(id: string) {
    if (!renameValue.trim()) return;
    await supabase.from('playlists').update({ title: renameValue.trim() }).eq('id', id);
    setRenamingId(null);
    setMenuOpenId(null);
    load();
  }

  async function toggleVisibility(id: string, current: string) {
    await supabase.from('playlists').update({ visibility: current === 'public' ? 'private' : 'public' }).eq('id', id);
    load();
  }

  async function changeColor(id: string, color: string) {
    await supabase.from('playlists').update({ color, thumbnail_url: null }).eq('id', id);
    setMenuOpenId(null);
    load();
  }

  async function uploadThumbnail(id: string, file: File) {
    if (!userId) {
      setThumbError(t('playlistThumbNoUser'));
      return;
    }
    setThumbError(null);
    // Úložiště pustí jen obrázek do 5 MB k vlastnímu playlistu (lib/imageUpload.ts).
    const problem = imageUploadProblem(file, 'playlistCover');
    const ext = imageUploadExt(file);
    if (problem || !ext) {
      setThumbError(problem === 'size' ? t('imageUploadTooBig').replace('{mb}', String(IMAGE_MAX_BYTES.playlistCover / 1024 / 1024)) : t('imageUploadBadType'));
      return;
    }
    const path = `${userId}/${id}.${ext}`;
    const { error } = await supabase.storage.from('playlist-covers').upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) {
      setThumbError(t('playlistThumbUploadFailed').replace('{error}', error.message));
      return;
    }
    const { data: publicUrlData } = supabase.storage.from('playlist-covers').getPublicUrl(path);
    const { error: updateError } = await supabase
      .from('playlists')
      .update({ thumbnail_url: `${publicUrlData.publicUrl}?t=${Date.now()}` })
      .eq('id', id);
    if (updateError) {
      setThumbError(t('playlistThumbSaveFailed').replace('{error}', updateError.message));
      return;
    }
    setMenuOpenId(null);
    load();
  }

  async function deletePlaylist(id: string) {
    await supabase.from('playlists').delete().eq('id', id);
    setMenuOpenId(null);
    load();
  }

  if (checking) return <p style={{ color: 'var(--text-faint)' }}>{t('loading')}</p>;

  if (!userId) {
    return (
      <div className="auth-gate">
        <p>{t('loginToCreatePlaylistsNote')}</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  const filtered = (query ? playlists.filter((p) => p.title.toLowerCase().includes(query)) : playlists)
    .filter((p) => !p.is_system);

  return (
    <div>
      <div className="playlists-head">
        <p className="section-title" style={{ margin: 0 }}>{t('playlistsTitle')}</p>
        <form onSubmit={createPlaylist} className="playlist-create">
          <UiIcon name="plus" size={16} />
          <input type="text" placeholder={t('newPlaylistNamePlaceholder')} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} aria-label={t('newPlaylistNamePlaceholder')} />
          <button type="submit" disabled={creating || !newTitle.trim()}>
            {t('create')}
          </button>
        </form>
      </div>
      {thumbError && <p className="error-text" style={{ marginBottom: 16 }}>{thumbError}</p>}

      {filtered.length === 0 ? (
        <div className="playlists-empty">
          <span className="playlists-empty-icon" aria-hidden="true">
            <PlaylistIcon size={26} />
          </span>
          <p>{t('noPlaylistsToShow')}</p>
        </div>
      ) : (
        <div className="video-grid">
          {filtered.map((p) => {
            const cover = playlistCover(p);
            const count = p.playlist_videos?.length ?? 0;
            const isPublic = p.visibility === 'public';
            return (
              <div key={p.id} className="playlist-card">
                <Link href={`/playlists/${p.id}`} className="playlist-card-link">
                  <div className="playlist-cover" style={cover ? undefined : { background: `linear-gradient(135deg, ${p.color ?? '#3a3a40'}, #111114)` }}>
                    {cover ? <img loading="lazy" decoding="async" src={cover} alt="" /> : <PlaylistIcon size={34} />}
                    <span className="playlist-cover-count">
                      <PlaylistIcon size={14} />
                      {count} {t('playlistVideoCountSuffix')}
                    </span>
                  </div>
                  {renamingId === p.id ? null : (
                    <>
                      <p className="video-card-title playlist-card-title">{p.title}</p>
                      <p className="playlist-card-meta">
                        <UiIcon name={isPublic ? 'globe' : 'lock'} size={12} />
                        {isPublic ? t('playlistVisibilityPublic') : t('playlistVisibilityPrivate')}
                      </p>
                    </>
                  )}
                </Link>

                {renamingId === p.id && (
                  <form
                    className="playlist-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void renamePlaylist(p.id);
                    }}
                  >
                    <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus aria-label={t('renameButton')} />
                    <button type="submit">{t('save')}</button>
                    <button type="button" className="playlist-rename-cancel" onClick={() => setRenamingId(null)} aria-label={t('cancel')}>
                      <UiIcon name="close" size={14} />
                    </button>
                  </form>
                )}

                <button
                  type="button"
                  onClick={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                  className="icon-btn playlist-card-menu-btn"
                  aria-label={t('playlistOptions')}
                  title={t('playlistOptions')}
                  aria-expanded={menuOpenId === p.id}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="12" cy="5.5" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="12" cy="18.5" r="1.8" />
                  </svg>
                </button>

                {menuOpenId === p.id && (
                  <div className="profile-dropdown playlist-card-menu" ref={menuRef}>
                    <button
                      className="profile-dropdown-item"
                      onClick={() => {
                        setRenamingId(p.id);
                        setRenameValue(p.title);
                        setMenuOpenId(null);
                      }}
                      disabled={p.is_system}
                    >
                      <span className="playlist-menu-label">
                        <UiIcon name="pencil" size={15} />
                        {t('renameButton')}
                      </span>
                    </button>

                    {!p.is_system && (
                      <button className="profile-dropdown-item" onClick={() => toggleVisibility(p.id, p.visibility ?? 'private')}>
                        <span className="playlist-menu-label">
                          <UiIcon name={isPublic ? 'globe' : 'lock'} size={15} />
                          {t('visibilityLabel')}
                        </span>
                        <span className="profile-dropdown-value">{isPublic ? t('playlistVisibilityPublic') : t('playlistVisibilityPrivate')}</span>
                      </button>
                    )}

                    <div className="playlist-menu-colors">
                      <p>{t('thumbnailColorLabel')}</p>
                      <div>
                        {COLOR_PRESETS.map((c) => {
                          // Výchozí šedá = bez vybrané barvy: obal je náhled prvního videa.
                          const auto = c === DEFAULT_PLAYLIST_COLOR;
                          const active = !p.thumbnail_url && (auto ? !hasChosenColor(p.color) : p.color === c);
                          return (
                            <button
                              key={c}
                              type="button"
                              onClick={() => changeColor(p.id, c)}
                              className={`playlist-color${auto ? ' playlist-color-auto' : ''}${active ? ' active' : ''}`}
                              style={{ background: c }}
                              aria-label={auto ? t('playlistCoverAuto') : c}
                              title={auto ? t('playlistCoverAuto') : undefined}
                            >
                              {auto && <UiIcon name="image" size={12} />}
                            </button>
                          );
                        })}
                      </div>
                      <label htmlFor={`playlist-thumb-${p.id}`} className="playlist-menu-upload">
                        <UiIcon name="image" size={14} />
                        {t('orUploadCustomImageLabel')}
                        <input
                          id={`playlist-thumb-${p.id}`}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadThumbnail(p.id, f);
                          }}
                        />
                      </label>
                    </div>

                    {!p.is_system && (
                      <button className="profile-dropdown-item playlist-menu-danger" onClick={() => setConfirmPlaylistId(p.id)}>
                        <span className="playlist-menu-label">
                          <UiIcon name="trash" size={15} />
                          {t('deletePlaylist')}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmPlaylistId && (
        <ConfirmDialog
          message={t('confirmDeletePlaylist')}
          onConfirm={() => { deletePlaylist(confirmPlaylistId); setConfirmPlaylistId(null); }}
          onCancel={() => setConfirmPlaylistId(null)}
        />
      )}
    </div>
  );
}

export default function PlaylistsPage() {
  return (
    <Suspense fallback={null}>
      <PlaylistsPageInner />
    </Suspense>
  );
}
