import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { deleteOrQueue, deleteStreamVideo, isCloudflareUid, queueCloudflareDelete } from '@/lib/cloudflareVideos';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Moderátor smaže nejvýš tolik cizích videí za hodinu (ukradený účet nevymaže celé Kine). */
const STAFF_DELETES_PER_HOUR = 60;
/** Cizí video smazané moderátorem zůstane u Cloudflare ještě tolik dní (správce ho může vrátit). */
const STAFF_DELETE_GRACE_DAYS = 7;

/**
 * Smaže video z Kine i z Cloudflare Stream.
 *
 * - Majitel: video zmizí hned a u Cloudflare se smaže hned (když Cloudflare
 *   zrovna neodpoví, smazání se zopakuje z fronty - dřív tam video zůstalo
 *   napořád a platilo se za něj).
 * - Moderátor (cizí video): z Kine zmizí hned, u Cloudflare se smaže až po
 *   7 dnech a každé smazání se zapíše (deleted_videos_log). Kdyby někdo
 *   ukradl účet moderátora, videa jdou vrátit; víc než 60 za hodinu nesmaže.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const { data: userData, error: userError } = await supabaseServer.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });
  const userId = userData.user.id;

  const body = await req.json().catch(() => ({}));
  const videoId = typeof body?.videoId === 'string' ? body.videoId.trim() : '';
  if (!UUID.test(videoId)) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  const { data: video } = await supabaseServer.from('videos').select('id, owner_id, cloudflare_video_id, title').eq('id', videoId).maybeSingle();
  if (!video) return NextResponse.json({ error: 'Video nenalezeno.' }, { status: 404 });

  const own = video.owner_id === userId;
  if (!own) {
    const { data: requester } = await supabaseServer.from('profiles').select('role').eq('id', userId).maybeSingle();
    const isModerator = requester?.role === 'moderator' || requester?.role === 'admin';
    if (!isModerator) return NextResponse.json({ error: 'Tohle video ti nepatří.' }, { status: 403 });
    const since = new Date(Date.now() - 3600 * 1000).toISOString();
    const recent = await supabaseServer
      .from('deleted_videos_log')
      .select('id', { count: 'exact', head: true })
      .eq('deleted_by', userId)
      .eq('by_staff', true)
      .gte('created_at', since);
    if (!recent.error && (recent.count ?? 0) >= STAFF_DELETES_PER_HOUR) {
      return NextResponse.json({ error: 'Moc mazání za krátkou dobu - zkus to prosím za chvíli.', code: 'slow' }, { status: 429 });
    }
  }

  const { error: deleteError } = await supabaseServer.from('videos').delete().eq('id', videoId);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const uid: string | null = isCloudflareUid(video.cloudflare_video_id) ? video.cloudflare_video_id : null;
  if (uid) {
    if (own) {
      await deleteOrQueue(uid, 'smazal majitel');
    } else {
      const queued = await queueCloudflareDelete(uid, `smazal moderátor ${userId}`, STAFF_DELETE_GRACE_DAYS * 24 * 3600 * 1000);
      // Bez fronty (migrace neproběhla) se smaže hned jako dřív.
      if (!queued) await deleteStreamVideo(uid);
    }
  }

  await supabaseServer
    .from('deleted_videos_log')
    .insert({ video_id: videoId, cf_uid: uid, owner_id: video.owner_id, deleted_by: userId, by_staff: !own, title: String(video.title ?? '').slice(0, 200) })
    .then(
      () => undefined,
      () => undefined
    );

  return NextResponse.json({ success: true });
}
