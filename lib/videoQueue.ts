'use client';

/**
 * Fronta videí ("Přidat do fronty").
 *
 * Fronta je jen v prohlížeči (localStorage), ne v databázi - je to
 * krátkodobá věc na jedno posezení, ne playlist, který si chce člověk
 * schovat. Na co ji chce mít napořád, na to jsou playlisty.
 *
 * Změny se rozhlašují událostí, takže se panel fronty u přehrávače
 * překreslí i tehdy, když video přidáš na jiné kartě appky.
 */

const STORAGE_KEY = 'kine-video-queue';
const QUEUE_EVENT = 'kine-queue-changed';
const MAX_QUEUE = 50;

export type QueuedVideo = {
  id: string;
  title: string;
  thumbnail_url: string | null;
  duration_seconds?: number | null;
  username?: string | null;
  /**
   * Bez tohohle nemá hudební přehrávač co pustit - přehrává se podle id
   * u Cloudflare, ne podle id videa v naší databázi. U položek přidaných
   * dřív chybí, takže si ho hudba v takovém případě dohledá sama.
   */
  cloudflare_video_id?: string | null;
};

export function getQueue(): QueuedVideo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.id === 'string') : [];
  } catch {
    // Rozbitý nebo nedostupný localStorage nesmí shodit celou stránku.
    return [];
  }
}

function saveQueue(queue: QueuedVideo[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE)));
  } catch {
    // Plný nebo zakázaný localStorage - fronta se prostě neuloží.
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
}

/** Vrátí true, když se video přidalo; false, když už ve frontě bylo. */
export function addToQueue(video: QueuedVideo): boolean {
  const queue = getQueue();
  if (queue.some((v) => v.id === video.id)) return false;
  saveQueue([...queue, video]);
  return true;
}

export function removeFromQueue(videoId: string) {
  saveQueue(getQueue().filter((v) => v.id !== videoId));
}

export function clearQueue() {
  saveQueue([]);
}

/** Video, které má hrát po tom právě běžícím. */
export function nextInQueue(currentVideoId: string): QueuedVideo | null {
  const queue = getQueue();
  const index = queue.findIndex((v) => v.id === currentVideoId);
  if (index >= 0) return queue[index + 1] ?? null;
  return queue[0] ?? null;
}

export function subscribeToQueue(listener: () => void): () => void {
  window.addEventListener(QUEUE_EVENT, listener);
  // "storage" se ozve, když se fronta změní na jiné kartě prohlížeče.
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(QUEUE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
