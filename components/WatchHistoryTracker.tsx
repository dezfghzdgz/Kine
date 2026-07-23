'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function WatchHistoryTracker({ videoId }: { videoId: string }) {
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { error } = await supabase.from('watch_history').upsert(
        {
          user_id: data.user.id,
          video_id: videoId,
          watched_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,video_id' }
      );
      if (error) {
        // Necháváme v konzoli pro snadné dohledání, kdyby migrace pro
        // historii ještě neproběhla v Supabase.
        console.error('Zápis do historie selhal:', error.message);
      }

      // Jakmile video sledujeme, odebere se samo ze "Sledovat později"
      const { data: systemPlaylist } = await supabase
        .from('playlists')
        .select('id')
        .eq('owner_id', data.user.id)
        .eq('is_system', true)
        .maybeSingle();

      if (systemPlaylist) {
        await supabase
          .from('playlist_videos')
          .delete()
          .eq('playlist_id', systemPlaylist.id)
          .eq('video_id', videoId);
      }
    });
  }, [videoId]);

  return null;
}
