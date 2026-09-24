'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Vrátí mapu { videoId -> procento sledovanosti (0-100) } pro daná videa.
// Zobrazuje se jako tyrkysová lišta dole na náhledu videa.
//
// Pozice se ukládá v sekundách (watch_history.progress_seconds) - na procenta
// se přepočítá podle délky videa. Dřív se sekundy braly rovnou jako procenta,
// takže po minutě sledování byla lišta v Exploreru plná.
export function useWatchProgress(videoIds: string[]) {
  const [progress, setProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!videoIds.length) return;

    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const { data } = await supabase
        .from('watch_history')
        .select('video_id, progress_seconds, completed, videos(duration_seconds)')
        .eq('user_id', authData.user.id)
        .in('video_id', videoIds);

      if (!data) return;

      const map: Record<string, number> = {};
      data.forEach((row: any) => {
        const duration = Number(row.videos?.duration_seconds ?? 0);
        if (row.completed) {
          map[row.video_id] = 100;
        } else if (row.progress_seconds > 0 && duration > 0) {
          map[row.video_id] = Math.min(100, Math.round((row.progress_seconds / duration) * 100));
        }
      });
      setProgress(map);
    }

    load();
  }, [videoIds.join(',')]);

  return progress;
}
