import { supabase } from './supabaseClient';

/**
 * Zápis do historie sledování (watch_history) - jedno místo pro stránku
 * videa (components/WatchHistoryTracker.tsx) i Sparks (components/SparksCard.tsx).
 *
 * Volá se až po pár vteřinách opravdového přehrávání (lib/playbackMeter.ts),
 * ne při otevření stránky. Bez přihlášení nedělá nic (prohlížeč si pamatuje
 * zhlédnuté zvlášť - lib/upNext.ts, rememberSeen).
 */
export async function saveWatchRow(
  videoId: string,
  fields: { progress_seconds?: number; completed?: boolean } = {}
): Promise<{ userId: string | null; ok: boolean }> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id ?? null;
    if (!userId || !videoId) return { userId, ok: false };
    const row: Record<string, unknown> = { user_id: userId, video_id: videoId, watched_at: new Date().toISOString() };
    if (typeof fields.progress_seconds === 'number' && Number.isFinite(fields.progress_seconds)) {
      row.progress_seconds = Math.max(0, Math.floor(fields.progress_seconds));
    }
    if (typeof fields.completed === 'boolean') row.completed = fields.completed;
    const { error } = await supabase.from('watch_history').upsert(row, { onConflict: 'user_id,video_id' });
    if (error) {
      // Necháváme v konzoli pro snadné dohledání (třeba když migrace historie ještě neproběhla).
      console.error('Zápis do historie selhal:', error.message);
    }
    return { userId, ok: !error };
  } catch {
    return { userId: null, ok: false };
  }
}
