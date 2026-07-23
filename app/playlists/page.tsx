'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import ConfirmDialog from '@/components/ConfirmDialog';

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
      .select('id, title, color, thumbnail_url, is_system, visibility, created_at, playlist_videos(video_id)')
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
      setThumbError('Appka ještě nezjistila tvého uživatele - zkus to prosím o chvíli znovu.');
      return;
    }
    setThumbError(null);
    const ext = file.name.split('.').pop();
    const path = `${userId}/${id}.${ext}`;
    const { error } = await supabase.storage.from('playlist-covers').upload(path, file, { upsert: true });
    if (error) {
      setThumbError(`Nahrání se nepovedlo (cesta: ${path}): ${error.message}`);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from('playlist-covers').getPublicUrl(path);
    const { error: updateError } = await supabase
      .from('playlists')
      .update({ thumbnail_url: `${publicUrlData.publicUrl}?t=${Date.now()}` })
      .eq('id', id);
    if (updateError) {
      setThumbError(`Uložení náhledu se nepovedlo: ${updateError.message}`);
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
        <p>Pro vytváření playlistů se musíš nejdřív přihlásit.</p>
        <Link href="/login">{t('loginLink')}</Link>
      </div>
    );
  }

  const filtered = (query ? playlists.filter((p) => p.title.toLowerCase().includes(query)) : playlists)
    .filter((p) => !p.is_system);

  return (
    <div>
      <p className="section-title">{t('playlistsTitle')}</p>
      {thumbError && <p className="error-text" style={{ marginBottom: 16 }}>{thumbError}</p>}

      <form onSubmit={createPlaylist} style={{ display: 'flex', gap: 8, marginBottom: 28, maxWidth: 420 }}>
        <input
          type="text"
          placeholder="Název nového playlistu…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={creating}>Vytvořit</button>
      </form>

      {filtered.length === 0 ? (
        <p style={{ color: 'var(--text-faint)' }}>{t('noPlaylistsToShow')}</p>
      ) : (
        <div className="video-grid">
          {filtered.map((p) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <Link href={`/playlists/${p.id}`} className="video-card">
                <div
                  className="video-thumb"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: p.thumbnail_url ? undefined : (p.color ?? '#3a3a40'),
                    position: 'relative', overflow: 'hidden',
                  }}
                >
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                  <span style={{
                    color: '#fff', fontSize: 13, fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                    position: p.thumbnail_url ? 'absolute' : 'static', bottom: p.thumbnail_url ? 8 : undefined, left: p.thumbnail_url ? 8 : undefined,
                  }}>
                    {p.is_system ? '🕒 ' : ''}{p.playlist_videos?.length ?? 0} videí
                  </span>
                </div>
                {renamingId === p.id ? null : (
                  <p className="video-card-title">
                    {p.title} {!p.is_system && (p.visibility === 'public' ? '🌐' : '🔒')}
                  </p>
                )}
              </Link>

              {renamingId === p.id && (
                <div style={{ display: 'flex', gap: 6, marginTop: -6 }}>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    style={{ flex: 1, fontSize: 13, padding: '6px 8px' }}
                    autoFocus
                  />
                  <button onClick={() => renamePlaylist(p.id)} style={{ fontSize: 12, padding: '6px 10px' }}>{t('save')}</button>
                </div>
              )}

              <button
                onClick={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                className="icon-btn"
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.5)', borderRadius: 999, color: '#fff' }}
              >
                ⋮
              </button>

              {menuOpenId === p.id && (
                <div className="profile-dropdown" ref={menuRef} style={{ top: 34, right: 6, bottom: 'auto', left: 'auto', width: 200 }}>
                  <button
                    className="profile-dropdown-item"
                    onClick={() => { setRenamingId(p.id); setRenameValue(p.title); setMenuOpenId(null); }}
                    disabled={p.is_system}
                  >
                    Přejmenovat
                  </button>

                  {!p.is_system && (
                    <button className="profile-dropdown-item" onClick={() => toggleVisibility(p.id, p.visibility ?? 'private')}>
                      <span>Viditelnost</span>
                      <span className="profile-dropdown-value">{p.visibility === 'public' ? 'Veřejný' : 'Soukromý'}</span>
                    </button>
                  )}

                  <div style={{ padding: '8px 8px 4px' }}>
                    <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>Barva náhledu</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {COLOR_PRESETS.map((c) => (
                        <button
                          key={c}
                          onClick={() => changeColor(p.id, c)}
                          style={{
                            width: 22, height: 22, borderRadius: '50%', background: c, padding: 0,
                            border: p.color === c && !p.thumbnail_url ? '2px solid var(--text)' : '2px solid transparent',
                          }}
                        />
                      ))}
                    </div>
                    <label htmlFor={`playlist-thumb-${p.id}`} style={{ cursor: 'pointer' }}>
                      <span style={{ fontSize: 11, color: 'var(--text)', textDecoration: 'underline', marginTop: 8, display: 'inline-block' }}>
                        Nebo nahrát vlastní obrázek
                      </span>
                      <input
                        id={`playlist-thumb-${p.id}`}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadThumbnail(p.id, f); }}
                      />
                    </label>
                  </div>

                  {!p.is_system && (
                    <button className="profile-dropdown-item" onClick={() => setConfirmPlaylistId(p.id)} style={{ color: '#ff6b6b' }}>
                      {t('deletePlaylist')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
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
