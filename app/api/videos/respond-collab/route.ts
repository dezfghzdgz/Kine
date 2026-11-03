import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { syncVideoProtection } from '@/lib/streamProtection';
import { collabRelease } from '@/lib/moderationVisibility';

/**
 * Odpověď na pozvánku ke spolupráci na videu.
 *
 * Přijetí   -> spolutvůrce se u videa zveřejní a video se objeví i na jeho kanálu.
 * Odmítnutí -> ze spolupráce odejde jen on sám. Video zůstává tvůrci.
 *
 * Dřív odmítnutí smazalo CELÉ video (i z Cloudflare) - stačilo, aby jeden
 * pozvaný kliknul na "Odmítnout", a nahrávající o video nenávratně přišel.
 * Kromě toho video zůstalo navždy soukromé, když se pozvaný neozval; teď se
 * viditelnost vrátí, jakmile na potvrzení nikdo další nečeká.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const { data: userData } = await supabaseServer.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: 'Musíš být přihlášený.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const videoId = typeof body?.videoId === 'string' ? body.videoId.toLowerCase() : '';
  const accept = body?.accept === true;
  if (!UUID.test(videoId)) return NextResponse.json({ error: 'Chybí videoId.' }, { status: 400 });

  // Jen vlastní čekající pozvánka. Dřív se viditelnost videa "uvolňovala"
  // i po volání s cizím videem, ke kterému volající žádnou pozvánku neměl.
  const { data: rows, error } = accept
    ? await supabaseServer
        .from('video_collaborators')
        .update({ status: 'accepted' })
        .eq('video_id', videoId)
        .eq('profile_id', userData.user.id)
        .eq('status', 'pending')
        .select('video_id')
    : await supabaseServer
        .from('video_collaborators')
        .delete()
        .eq('video_id', videoId)
        .eq('profile_id', userData.user.id)
        .select('video_id');

  if (error) return NextResponse.json({ error: 'Odpověď se nepodařilo uložit.' }, { status: 400 });
  if (!rows || rows.length === 0) return NextResponse.json({ error: 'Pozvánka nenalezena.' }, { status: 404 });

  await releaseVisibilityIfEveryoneAnswered(videoId);

  return NextResponse.json({ ok: true, accepted: accept });
}

/**
 * Dokud video čeká na potvrzení, drží ho appka jako soukromé. Jakmile na
 * odpověď nikdo další nečeká - ať už všichni přijali, nebo někdo odmítl -
 * vrátí se viditelnost, kterou tvůrce původně zvolil. Video tak nezůstane
 * uvězněné jako soukromé kvůli někomu, kdo se nikdy neozval.
 *
 * Nikdy ale ne u videa skrytého kontrolou obsahu (moderation_hold): dřív stačilo
 * si do pending_collab_visibility zapsat "public", pozvat druhý účet a ten
 * pozvánku odmítnout - server (service role) skryté video zase zveřejnil.
 * Skryté video pouští jen moderátor (lib/moderationVisibility.ts).
 */
async function releaseVisibilityIfEveryoneAnswered(videoId: string) {
  const { data: stillPending } = await supabaseServer
    .from('video_collaborators')
    .select('profile_id')
    .eq('video_id', videoId)
    .eq('status', 'pending');

  if (stillPending && stillPending.length > 0) return;

  // select('*') schválně: moderation_hold je až s migrací podpory-kontrola - bez ní
  // sloupec chybí (a skrývat se nedá nic), dotaz na jméno sloupce by spadl.
  const { data: videoRow } = await supabaseServer.from('videos').select('*').eq('id', videoId).maybeSingle();
  const row = videoRow as Record<string, unknown> | null;
  if (!row) return;
  const decision = collabRelease(row as { pending_collab_visibility?: string | null; moderation_hold?: string | null });
  if (decision.action === 'none') return;

  if (decision.action === 'clear') {
    await supabaseServer.from('videos').update({ pending_collab_visibility: null }).eq('id', videoId);
    return;
  }

  let update = supabaseServer
    .from('videos')
    .update({ visibility: decision.visibility, pending_collab_visibility: null })
    .eq('id', videoId);
  // Kontrola obsahu mohla video skrýt mezi čtením a zápisem - pak se nezapíše nic.
  if (Object.prototype.hasOwnProperty.call(row, 'moderation_hold')) update = update.is('moderation_hold', null);
  const { data: changed, error } = await update.select('id');
  if (error || !changed || changed.length === 0) return;
  // Viditelnost se změnila -> ochrana podepsanými adresami se srovná
  // (lib/streamProtection.ts; bez nastaveného klíče nic nedělá).
  await syncVideoProtection(videoId);
}
