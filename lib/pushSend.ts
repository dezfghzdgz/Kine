import { supabaseServer } from './supabaseServer';
import { sendWebPush, vapidKeysFromEnv, type PushTarget } from './webPush';
import { clip, pushText } from './pushText';

/**
 * Push oznámení: z oznámení ve zvonečku (tabulka notifications) udělá
 * zprávu na telefon / počítač každého zařízení příjemce.
 *
 * - Každé oznámení se pošle nejvýš jednou: kdo první zapíše pushed_at,
 *   ten posílá (server po vložení oznámení, prohlížeč přes /api/push/flush).
 * - Posílá se jen pár druhů: živě, nové video / příspěvek (odběratelé se
 *   zvonečkem), komentář / odpověď / pozvánka ke spolupráci, podpora
 *   (tvůrci) a upozornění pro správce. Lajky, odběry a odznaky jen ve zvonečku.
 * - Text se skládá znovu v jazyce zařízení z údajů v databázi (jméno kanálu,
 *   název videa) - nikdy se neposílá text, který napsal jiný uživatel.
 * - Komentáře: nejvýš 6 zpráv za 10 minut na člověka (víc jen ve zvonečku).
 * - Zařízení, které oznámení zrušilo (push služba vrátí 404/410), se smaže.
 */

export type PushCategory = 'live' | 'uploads' | 'replies' | 'earnings' | 'admin';
type NRow = { id: string; user_id: string; type: string | null; message: string | null; link: string | null; sender_id: string | null; created_at: string };
type SubRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; lang: string };
type Prefs = { live: boolean; uploads: boolean; replies: boolean; earnings: boolean };
export type PushPayload = { title: string; body: string; url: string; tag: string };
type Job = { sub: SubRow; payload: PushPayload; ttl: number; urgency: 'normal' | 'high'; topic?: string };

const CLAIM_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS = 3000;
const CONCURRENCY = 25;
const REPLIES_PER_10_MIN = 6;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SELECT = 'id, user_id, type, message, link, sender_id, created_at';

/** Do jaké skupiny oznámení patří (null = jen ve zvonečku, na telefon ne). */
export function pushCategory(n: { type: string | null; link: string | null; sender_id: string | null }): PushCategory | null {
  switch (n.type) {
    case 'live':
      return n.sender_id ? null : 'live';
    case 'new_video':
    case 'new_post':
      return n.sender_id ? null : 'uploads';
    case 'comment_reply':
    case 'collab_invite':
      return 'replies';
    case 'donation':
      return n.sender_id ? null : 'earnings';
    case 'default':
      return !n.sender_id && (n.link ?? '').startsWith('/admin/') ? 'admin' : null;
    default:
      return null;
  }
}

/** Odkaz z oznámení - jen cesta uvnitř Kine. */
export function safePushUrl(link: string | null | undefined): string {
  return typeof link === 'string' && /^\/(?![/\\])[^\s]{0,300}$/.test(link) ? link : '/';
}

function idFrom(link: string | null, prefix: string): string | null {
  const m = new RegExp(`^/${prefix}/(${UUID})`, 'i').exec(link ?? '');
  return m ? m[1].toLowerCase() : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Zabere oznámení podle id (jen čerstvá a ještě neposlaná). */
async function claimByIds(ids: string[]): Promise<NRow[]> {
  const valid = ids.filter((id) => new RegExp(`^${UUID}$`, 'i').test(id));
  if (valid.length === 0) return [];
  const since = new Date(Date.now() - CLAIM_WINDOW_MS).toISOString();
  const now = new Date().toISOString();
  const out: NRow[] = [];
  for (const part of chunks(valid, 300)) {
    const { data, error } = await supabaseServer
      .from('notifications')
      .update({ pushed_at: now })
      .in('id', part)
      .is('pushed_at', null)
      .gte('created_at', since)
      .select(SELECT);
    if (error) return out; // bez migrace (sloupec pushed_at) se nic neposílá
    out.push(...((data ?? []) as NRow[]));
  }
  return out;
}

/** Zabere čerstvá oznámení, která právě poslal tenhle uživatel (komentář, pozvánka). */
async function claimBySender(senderId: string): Promise<NRow[]> {
  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data, error } = await supabaseServer
    .from('notifications')
    .update({ pushed_at: new Date().toISOString() })
    .eq('sender_id', senderId)
    .in('type', ['comment_reply', 'collab_invite'])
    .is('pushed_at', null)
    .gte('created_at', since)
    .select(SELECT);
  if (error) return [];
  return (data ?? []) as NRow[];
}

async function loadSubs(userIds: string[]): Promise<SubRow[]> {
  const out: SubRow[] = [];
  for (const part of chunks(userIds, 300)) {
    const { data, error } = await supabaseServer.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth, lang').in('user_id', part);
    if (error) return out;
    out.push(...((data ?? []) as SubRow[]));
  }
  return out;
}

async function loadPrefs(userIds: string[]): Promise<Map<string, Prefs>> {
  const map = new Map<string, Prefs>();
  for (const part of chunks(userIds, 300)) {
    const { data } = await supabaseServer.from('push_settings').select('user_id, live, uploads, replies, earnings').in('user_id', part);
    for (const r of (data ?? []) as (Prefs & { user_id: string })[]) map.set(r.user_id, r);
  }
  return map;
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (const part of chunks(unique, 300)) {
    const { data } = await supabaseServer.from('profiles').select('id, username, display_name').in('id', part);
    for (const p of (data ?? []) as { id: string; username: string | null; display_name: string | null }[]) {
      map.set(p.id, p.display_name || p.username || 'Kine');
    }
  }
  return map;
}

/** Údaje pro texty: jména kanálů, názvy přenosů, videí a příspěvků. */
async function loadContext(rows: NRow[]) {
  const liveOwners = rows.filter((r) => r.type === 'live').map((r) => idFrom(r.link, 'live')).filter((x): x is string => !!x);
  const videoIds = rows.filter((r) => r.type === 'new_video' || r.type === 'collab_invite').map((r) => idFrom(r.link, 'watch')).filter((x): x is string => !!x);
  const postIds = rows.filter((r) => r.type === 'new_post').map((r) => idFrom(r.link, 'post')).filter((x): x is string => !!x);

  const liveTitles = new Map<string, string>();
  if (liveOwners.length) {
    const { data } = await supabaseServer.from('live_streams').select('owner_id, title').in('owner_id', [...new Set(liveOwners)]);
    for (const r of (data ?? []) as { owner_id: string; title: string | null }[]) liveTitles.set(r.owner_id, r.title ?? '');
  }
  const videos = new Map<string, { title: string; owner_id: string }>();
  for (const part of chunks([...new Set(videoIds)], 300)) {
    const { data } = await supabaseServer.from('videos').select('id, title, owner_id').in('id', part);
    for (const v of (data ?? []) as { id: string; title: string | null; owner_id: string }[]) videos.set(v.id, { title: v.title ?? '', owner_id: v.owner_id });
  }
  const posts = new Map<string, { content: string; owner_id: string; members_only: boolean }>();
  for (const part of chunks([...new Set(postIds)], 300)) {
    let res = await supabaseServer.from('posts').select('id, content, owner_id, members_only').in('id', part);
    if (res.error) res = (await supabaseServer.from('posts').select('id, content, owner_id').in('id', part)) as typeof res;
    for (const p of (res.data ?? []) as { id: string; content: string | null; owner_id: string; members_only?: boolean }[]) {
      posts.set(p.id, { content: p.content ?? '', owner_id: p.owner_id, members_only: !!p.members_only });
    }
  }
  const people = await names([
    ...liveOwners,
    ...[...videos.values()].map((v) => v.owner_id),
    ...[...posts.values()].map((p) => p.owner_id),
    ...rows.map((r) => r.sender_id ?? ''),
  ]);
  return { liveTitles, videos, posts, people };
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

/** Text zprávy pro jedno oznámení v jazyce zařízení (null = neposílat). */
export function composePush(row: NRow, lang: string, ctx: Ctx): PushPayload | null {
  const url = safePushUrl(row.link);
  switch (row.type) {
    case 'live': {
      const owner = idFrom(row.link, 'live');
      if (!owner) return null;
      const title = ctx.liveTitles.get(owner) ?? '';
      return { title: clip(pushText(lang, 'liveTitle', { name: ctx.people.get(owner) ?? 'Kine' }), 60), body: clip(title || pushText(lang, 'liveBody'), 120), url, tag: `live-${owner}` };
    }
    case 'new_video': {
      const id = idFrom(row.link, 'watch');
      const v = id ? ctx.videos.get(id) : null;
      if (!v) return null;
      return { title: clip(pushText(lang, 'videoTitle', { name: ctx.people.get(v.owner_id) ?? 'Kine' }), 60), body: clip(v.title, 120), url, tag: `video-${id}` };
    }
    case 'new_post': {
      const id = idFrom(row.link, 'post');
      const p = id ? ctx.posts.get(id) : null;
      if (!p) return null;
      const body = p.content ? clip(p.content, 120) : p.members_only ? pushText(lang, 'postMembers') : '';
      return { title: clip(pushText(lang, 'postTitle', { name: ctx.people.get(p.owner_id) ?? 'Kine' }), 60), body, url, tag: `post-${id}` };
    }
    case 'comment_reply':
      return { title: clip(pushText(lang, 'replyTitle', { name: (row.sender_id && ctx.people.get(row.sender_id)) || 'Kine' }), 60), body: pushText(lang, 'replyBody'), url, tag: `reply-${row.id}` };
    case 'collab_invite': {
      const id = idFrom(row.link, 'watch');
      const v = id ? ctx.videos.get(id) : null;
      return { title: clip(pushText(lang, 'collabTitle', { name: (row.sender_id && ctx.people.get(row.sender_id)) || 'Kine' }), 60), body: clip(v?.title ?? '', 120), url, tag: `collab-${row.id}` };
    }
    case 'donation': {
      // Text podpory skládá Kine česky (částka a jméno; vzkaz od diváka se do zprávy
      // nedává - ten je ve zvonečku). V jiných jazycích jen obecná věta.
      const summary = String(row.message ?? '').split(/:\s*„/)[0];
      const body = lang === 'cs' || lang === 'sk' ? clip(summary, 120) : pushText(lang, 'tipBody');
      return { title: pushText(lang, 'tipTitle'), body, url, tag: `tip-${row.id}` };
    }
    case 'default':
      return { title: pushText(lang, 'adminTitle'), body: clip(row.message ?? '', 160), url, tag: `admin-${row.id}` };
    default:
      return null;
  }
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, size = CONCURRENCY) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
      }
    })
  );
}

async function deliver(rows: NRow[]): Promise<number> {
  const keys = vapidKeysFromEnv();
  if (!keys) return 0;
  const wanted = rows.filter((r) => pushCategory(r));
  if (wanted.length === 0) return 0;
  const userIds = [...new Set(wanted.map((r) => r.user_id))];
  const [subs, prefs] = await Promise.all([loadSubs(userIds), loadPrefs(userIds)]);
  if (subs.length === 0) return 0;
  const subsByUser = new Map<string, SubRow[]>();
  for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);

  // Komentáře a pozvánky: kolik už dotyčný za 10 minut dostal (proti zahlcení telefonu).
  const replyUsers = [...new Set(wanted.filter((r) => pushCategory(r) === 'replies').map((r) => r.user_id))].filter((u) => subsByUser.has(u));
  const recentReplies = new Map<string, number>();
  if (replyUsers.length) {
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data } = await supabaseServer
      .from('notifications')
      .select('user_id')
      .in('user_id', replyUsers)
      .in('type', ['comment_reply', 'collab_invite'])
      .gt('pushed_at', since)
      .limit(5000);
    for (const r of (data ?? []) as { user_id: string }[]) recentReplies.set(r.user_id, (recentReplies.get(r.user_id) ?? 0) + 1);
  }

  const ctx = await loadContext(wanted.filter((r) => subsByUser.has(r.user_id)));
  const jobs: Job[] = [];
  for (const row of wanted) {
    const devices = subsByUser.get(row.user_id);
    if (!devices) continue;
    const cat = pushCategory(row)!;
    const p = prefs.get(row.user_id);
    if (cat !== 'admin' && p && p[cat] === false) continue;
    if (cat === 'replies' && (recentReplies.get(row.user_id) ?? 0) > REPLIES_PER_10_MIN) continue;
    for (const sub of devices) {
      const payload = composePush(row, sub.lang, ctx);
      if (!payload) continue;
      const live = row.type === 'live';
      jobs.push({
        sub,
        payload,
        ttl: live ? 2 * 3600 : cat === 'admin' ? 12 * 3600 : 24 * 3600,
        urgency: live || cat === 'admin' ? 'high' : 'normal',
        topic: live ? `l${payload.tag.replace(/[^A-Za-z0-9]/g, '').slice(-30)}` : undefined,
      });
      if (jobs.length >= MAX_SENDS) break;
    }
    if (jobs.length >= MAX_SENDS) {
      console.warn('Kine: push - moc příjemců naráz, zbytek jen ve zvonečku');
      break;
    }
  }
  return sendJobs(jobs, keys);
}

async function sendJobs(jobs: Job[], keys: NonNullable<ReturnType<typeof vapidKeysFromEnv>>): Promise<number> {
  const gone = new Set<string>();
  const ok = new Set<string>();
  await runPool(jobs, async (job) => {
    const target: PushTarget = { endpoint: job.sub.endpoint, p256dh: job.sub.p256dh, auth: job.sub.auth };
    const res = await sendWebPush(target, job.payload, keys, { ttl: job.ttl, urgency: job.urgency, topic: job.topic });
    if (res.ok) ok.add(job.sub.id);
    else if (res.gone) gone.add(job.sub.id);
  });
  for (const part of chunks([...gone], 300)) await supabaseServer.from('push_subscriptions').delete().in('id', part);
  for (const part of chunks([...ok].filter((id) => !gone.has(id)), 300)) {
    await supabaseServer.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), failures: 0 }).in('id', part);
  }
  return ok.size;
}

/** Po vložení oznámení serverem (živě, nové video, příspěvek, podpora, správce). */
export async function pushNotificationsByIds(ids: string[]): Promise<number> {
  if (!vapidKeysFromEnv() || ids.length === 0) return 0;
  try {
    return await deliver(await claimByIds(ids));
  } catch (e) {
    console.error('Kine: push selhal -', (e as Error).message);
    return 0;
  }
}

/** Oznámení, která právě vložil prohlížeč uživatele (komentář, pozvánka ke spolupráci). */
export async function pushFromSender(senderId: string): Promise<number> {
  if (!vapidKeysFromEnv()) return 0;
  try {
    return await deliver(await claimBySender(senderId));
  } catch (e) {
    console.error('Kine: push selhal -', (e as Error).message);
    return 0;
  }
}

/** Zkušební zpráva na všechna zařízení uživatele. */
export async function pushTest(userId: string): Promise<{ devices: number; sent: number }> {
  const keys = vapidKeysFromEnv();
  if (!keys) return { devices: 0, sent: 0 };
  const subs = await loadSubs([userId]);
  const jobs: Job[] = subs.map((sub) => ({
    sub,
    payload: { title: pushText(sub.lang, 'testTitle'), body: pushText(sub.lang, 'testBody'), url: '/settings#notifications', tag: 'test' },
    ttl: 600,
    urgency: 'high',
  }));
  return { devices: subs.length, sent: await sendJobs(jobs, keys) };
}

/** Id vložených oznámení (z .insert(...).select('id')). */
export function insertedIds(data: unknown): string[] {
  return Array.isArray(data) ? data.map((r) => String((r as { id?: unknown })?.id ?? '')).filter(Boolean) : [];
}
