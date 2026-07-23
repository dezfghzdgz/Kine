'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Vrátí mapu { videoId -> procento sledovanosti (0-100) } pro daná videa.
// Zobrazuje se jako tyrkysová lišta dole na náhledu videa.
export function useWatchProgress(videoIds: string[]) {
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!videoIds.length) return;

    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const { data } = await supabase
        .from('watch_history')
        .select('video_id, progress_seconds, completed')
        .eq('user_id', authData.user.id)
        .in('video_id', videoIds);

      if (!data) return;

      const map: Record<string, number> = {};
      data.forEach((row) => {
        if (row.completed) {
          map[row.video_id] = 100;
        } else if (row.progress_seconds > 0) {
          map[row.video_id] = row.progress_seconds;
        }
      });
      setProgress(map);
    }

    load();
  }, [videoIds.join(',')]);

  return progress;
}
