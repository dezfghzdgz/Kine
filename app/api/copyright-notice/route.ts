import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import { videoIdFromUrl } from '@/lib/embed';
import { NOTICES_PER_HOUR_PER_IP, tidy, validateNotice, type NoticeInput } from '@/lib/copyrightNotice';

/**
 * Přijme oznámení o porušení autorských práv (formulář /copyright).
 *
 * Bez přihlášení - držitel práv obvykle účet nemá. Proto: ověření polí
 * (lib/copyrightNotice.ts), strop na počet oznámení z jedné adresy za
 * hodinu, a zápis přes server (tabulka nemá insert policy). Moderátoři
 * dostanou oznámení a frontu vidí v /reports.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Partial<NoticeInput>;
  const input: NoticeInput = {
    name: String(body.name ?? ''),
    email: String(body.email ?? ''),
    organization: body.organization ? String(body.organization) : '',
    videoUrl: String(body.videoUrl ?? ''),
    description: String(body.description ?? ''),
    goodFaith: body.goodFaith === true,
  };

  const problems = validateNotice(input, videoIdFromUrl);
  if (problems.length > 0) {
    return NextResponse.json({ error: 'Formulář není vyplněný správně.', problems }, { status: 400 });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabaseServer
    .from('copyright_notices')
    .select('id', { count: 'exact', head: true })
    .eq('sender_ip', ip)
    .gte('created_at', hourAgo);

  if (countError) {
    return NextResponse.json(
      { error: 'Oznámení zatím nejde přijmout (chybí migrace supabase-migration-autorska-prava.sql).' },
      { status: 503 }
    );
  }
  if ((count ?? 0) >= NOTICES_PER_HOUR_PER_IP) {
    return NextResponse.json({ error: 'Příliš mnoho oznámení. Zkus to za hodinu.' }, { status: 429 });
  }

  const videoId = videoIdFromUrl(input.videoUrl.trim());
  const { data: video } = await supabaseServer.from('videos').select('id, title').eq('id', videoId).maybeSingle();

  const { data: notice, error } = await supabaseServer
    .from('copyright_notices')
    .insert({
      video_id: video?.id ?? null,
      video_url: input.videoUrl.trim().slice(0, 500),
      claimant_name: tidy(input.name, 200),
      claimant_email: input.email.trim().slice(0, 320),
      claimant_org: tidy(input.organization, 200),
      work_description: (input.description ?? '').trim().slice(0, 4000),
      good_faith: true,
      sender_ip: ip.slice(0, 64),
    })
    .select('id')
    .single();

  if (error || !notice) {
    return NextResponse.json({ error: error?.message ?? 'Oznámení se nepodařilo uložit.' }, { status: 500 });
  }

  // Moderátoři a admini se dozví hned - fronta je v /reports.
  const { data: staff } = await supabaseServer.from('profiles').select('id').in('role', ['moderator', 'admin']);
  if (staff && staff.length > 0) {
    const message = video
      ? `Oznámení o autorských právech: „${video.title}“`
      : 'Oznámení o autorských právech (video nenalezeno)';
    // Bez "type": povolené druhy oznámení jsou dané kontrolou v databázi a
    // tohle mezi nimi není - výchozí druh stačí.
    await supabaseServer
      .from('notifications')
      .insert(staff.map((s) => ({ user_id: s.id, message, link: '/reports' })))
      .then(() => undefined, () => undefined);
  }

  return NextResponse.json({ ok: true, id: notice.id, videoFound: !!video });
}
