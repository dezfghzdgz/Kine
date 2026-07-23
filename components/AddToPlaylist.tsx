'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useLanguage } from '@/lib/i18n';

export default function AddToPlaylist({ videoId }: { videoId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadPlaylists() {
    if (!userId) {
      router.push('/login');
      return;
    }
    const { data } = await supabase
      .from('playlists')
      .select('id, title')
      .eq('owner_id', userId);
    setPlaylists(data ?? []);
    setOpen(true);
  }

  async function addTo(playlistId: string) {
    await supabase.from('playlist_videos').upsert({ playlist_id: playlistId, video_id: videoId });
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={menuRef}>
      <button className="reaction-btn" onClick={loadPlaylists}>+ Playlist</button>
      {open && (
        <div className="profile-dropdown" style={{ bottom: 'auto', top: 'calc(100% + 8px)', left: 0 }}>
          {playlists.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', padding: 8 }}>
              {t('noPlaylistYetShort')}
            </p>
          ) : (
            playlists.map((p) => (
              <button key={p.id} className="profile-dropdown-item" onClick={() => addTo(p.id)}>
                {p.title}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
