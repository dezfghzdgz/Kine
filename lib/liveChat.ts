/**
 * Chat k živému vysílání (room "channel:<id kanálu>") a k premiéře
 * ("video:<id videa>"). Čistá logika bez databáze - má test.
 */
export const CHAT_MAX_LENGTH = 300;
export const CHAT_MIN_INTERVAL_MS = 1500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ChatRoom = { kind: 'channel' | 'video'; id: string; key: string };

export function parseChatRoom(value: unknown): ChatRoom | null {
  if (typeof value !== 'string') return null;
  const m = /^(channel|video):(.+)$/.exec(value.trim());
  if (!m || !UUID.test(m[2])) return null;
  const id = m[2].toLowerCase();
  return { kind: m[1] as 'channel' | 'video', id, key: `${m[1]}:${id}` };
}

export function channelRoom(channelId: string): string {
  return `channel:${channelId.toLowerCase()}`;
}

export function videoRoom(videoId: string): string {
  return `video:${videoId.toLowerCase()}`;
}

/** Jak dlouho už přenos běží: "12:05" nebo "1:02:33". */
export function liveElapsed(startedAt: string | null | undefined, now = Date.now()): string {
  if (!startedAt) return '';
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
