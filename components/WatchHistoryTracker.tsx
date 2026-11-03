'use client';

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { rememberSeen } from '@/lib/upNext';
import { clearImpression } from '@/lib/feedImpressions';
import { EMPTY_METER, REAL_PLAYBACK_S, meterStep, type PlaybackSample } from '@/lib/playbackMeter';
import { saveWatchRow } from '@/lib/watchHistory';

/**
 * Zápis do historie sledování.
 *
 * Dřív se video zapsalo do historie hned při otevření stránky - i když ho
 * divák po dvou vteřinách zavřel (nebo se díval jen na odpočet premiéry).
 * Takové video pak hlavní stránka pohřbila jako "zhlédnuté", po konci jiného
 * videa se nenabídlo a počítalo se jako zájem o jeho kategorii. Teď se
 * zapíše až po ~3 s opravdového přehrávání (lib/playbackMeter.ts) -
 * přeskakování ani stojící video se nepočítají.
 *
 * Co na řádku stojí: historie, Aktivita, statistiky kanálu, "Pokračovat ve
 * sledování" (to potřebuje pozici - ukládá ji stránka videa každých 8 s)
 * a doporučování. Všechno funguje dál, jen bez překliků.
 *
 * `readPlayback` čte stránka z přehrávače (nebo z hudebního přehrávače na
 * Obal); null = nic nehraje.
 */
export default function WatchHistoryTracker({ videoId, readPlayback }: { videoId: string; readPlayback: () => PlaybackSample | null }) {
  const readRef = useRef(readPlayback);
  readRef.current = readPlayback;

  useEffect(() => {
    let meter = EMPTY_METER;
    let done = false;
    const timer = window.setInterval(() => {
      if (done) return;
      let sample: PlaybackSample | null = null;
      try {
        sample = readRef.current();
      } catch {
        sample = null;
      }
      if (!sample) return;
      meter = meterStep(meter, sample);
      if (meter.played < REAL_PLAYBACK_S) return;
      done = true;
      window.clearInterval(timer);
      void record(videoId, sample.time);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [videoId]);

  return null;
}

async function record(videoId: string, position: number) {
  // Zhlédnuté video si pamatuje i prohlížeč (i bez přihlášení) - po konci se nabízí jen nová (lib/upNext.ts).
  rememberSeen(videoId);
  // Na kartu na hlavní stránce se kliklo a video se opravdu hraje - žádná penalizace za "viděl a nechtěl".
  clearImpression(videoId);
  const at = Number(position);
  const { userId } = await saveWatchRow(videoId, Number.isFinite(at) && at > 0 ? { progress_seconds: at } : {});
  if (!userId) return;

  // Jakmile video sledujeme, odebere se samo ze "Sledovat později"
  const { data: systemPlaylist } = await supabase
    .from('playlists')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_system', true)
    .maybeSingle();

  if (systemPlaylist) {
    await supabase.from('playlist_videos').delete().eq('playlist_id', systemPlaylist.id).eq('video_id', videoId);
  }
}
